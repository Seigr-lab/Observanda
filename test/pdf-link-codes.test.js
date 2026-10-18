import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {initWasm,Resvg} from '@resvg/resvg-wasm';
import jsQR from 'jsqr';
import {parse} from 'parse5';
import {pdfLinkCodes,PDF_LINK_CODE_MODULE_MM} from '../src/pdf-link-codes.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfStructureDefaults} from '../src/web/pdf-structure-model.js';
import {changePdfPublication} from '../src/web/pdf-audience-model.js';
import {pdfCompositionDefaults} from '../src/web/pdf-composition-model.js';
const header=()=>({version:1,id:randomUUID(),name:'Printed link guide',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),externalLinks:false,printQrCodes:true}});
const text=href=>({type:'text',text:'Exact source',marks:[{type:'link',attrs:{href,title:'',target:'_self',nofollow:false}}]});
const prose=(...links)=>({type:'doc',content:[{type:'paragraph',content:links.map(text)}]});
const section=content=>({id:randomUUID(),title:'Selected results',content,layout:null,start:null});
const citation=url=>({type:'book_citation',attrs:{version:1,id:randomUUID(),title:'Cited result',authors:'A researcher',issued:'2026',locator:'page 2',url}});
const collector=options=>pdfLinkCodes({enabled:true,sectionId:'selected-section',columnWidthMm:170,heightMm:257,maxBytes:1024*1024,font:'atkinson',...options});
const svgs=html=>[...html.matchAll(/<svg\b[^]*?<\/svg>/g)].map(match=>match[0]);
const descendants=function*(node){yield node;for(const child of node.childNodes??[])yield*descendants(child);};
const hasClass=(node,name)=>!!node.attrs?.find(attr=>attr.name==='class')?.value.split(' ').includes(name);
let wasm;
async function decode(svg){
 await (wasm??=readFile(new URL(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))).then(initWasm));
 const edge=Number(/viewBox="0 0 (\d+)/.exec(svg)[1]),renderer=new Resvg(svg,{fitTo:{mode:'width',value:edge*5},font:{loadSystemFonts:false}}),image=renderer.render();
 try{
  const pixels=new Uint8ClampedArray(image.pixels);assert.equal(image.width,edge*5);assert.equal(image.height,edge*5);
  // Rasterized quiet zone stays entirely white on all four sides.
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(x<20||y<20||x>=image.width-20||y>=image.height-20){const at=(y*image.width+x)*4;assert.deepEqual([...pixels.subarray(at,at+4)],[255,255,255,255]);}
  const result=jsQR(pixels,image.width,image.height,{inversionAttempts:'dontInvert'});assert.ok(result,'independent decoder recognizes rendered SVG');return result.data;
 }finally{image.free();renderer.free();}
}

test('local vector codes independently decode exact URLs with quiet zones and physical scan size',async()=>{
 const urls=['https://example.org/result?a=1&b=%22quoted%22','mailto:research@example.org','tel:+4712345678','https://example.org/'+String.fromCodePoint(0x3b1,0x3b2)+'?a=<value>','https://example.org/'+ 'a'.repeat(1004)];
 for(const url of urls){const codes=collector();codes.observe(text(url));const html=await codes.render(),[svg]=svgs(html);assert.equal(await decode(svg),url);const width=Number(/width="([\d.]+)mm"/.exec(svg)[1]),edge=Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);assert.ok(width>=24);assert.ok(width/edge>=PDF_LINK_CODE_MODULE_MM-1e-10);assert.match(svg,/role="img" aria-label="QR code for /);assert.match(html,/<figcaption dir="ltr">/);assert.doesNotMatch(html,/<a\b|<image\b|href=|<value>/);}
});

test('section collection deduplicates prose, citation and all note destinations before interactive stripping',async()=>{
 const h=header();h.layout.links='disabled';const s=section(prose('https://example.org/main','https://example.org/main'));
 s.content.content.push(citation('https://example.org/cited'));
 s.notes=['footnote','page-footnote','endnote'].map((kind,index)=>({id:randomUUID(),kind,block:0,content:index===1?{type:'doc',content:[citation('https://example.org/cited')]}:prose(index===0?'mailto:research@example.org':'tel:+4712345678')}));
 const result=await compilePdfDocument(h,[s]),codes=svgs(result.html);assert.equal(codes.length,4);assert.doesNotMatch(result.html,/<a\b/);
 const urls=[];for(const svg of codes)urls.push(await decode(svg));assert.deepEqual(urls,['https://example.org/main','https://example.org/cited','mailto:research@example.org','tel:+4712345678']);
 assert.equal((result.html.match(/<figcaption dir="ltr">https:\/\/example.org\/main<\/figcaption>/g)??[]).length,1);
 const second=section(prose('https://example.org/main'));assert.equal(svgs((await compilePdfDocument(h,[s,second])).html).length,5);
});

test('QR opt-out, audience exclusion and forbidden protocols cannot disclose destinations',async()=>{
 const h=header(),s=section(prose('https://example.org/visible'));
 delete h.structure.printQrCodes;const original=await compilePdfDocument(h,[s]);h.structure.printQrCodes=false;assert.equal((await compilePdfDocument(h,[s])).html,original.html);assert.doesNotMatch(original.html,/pdf-link-code|https:\/\/example.org\/visible/);
 const codes=collector();for(const href of ['#internal','/local','file:///unread','data:text/plain,unread','javascript:alert(1)','https://user:password@example.org/','https://example.org/unsafe path'])codes.observe(text(href));assert.equal(await codes.render(),'');
 h.structure.printQrCodes=true;h.audience='public';changePdfPublication(h,s,'audience-review');const hidden=section(prose('https://example.org/private-'+ 'x'.repeat(1200)));hidden.notes=[{id:randomUUID(),kind:'endnote',block:0,content:prose('https://example.org/secret-note')}];changePdfPublication(h,hidden,'audience-omit');
 const selected=await compilePdfDocument(h,[s,hidden]);assert.equal(svgs(selected.html).length,1);assert.doesNotMatch(selected.html,/private-|secret-note/);
 hidden.publication={version:1,include:true,review:null};await assert.rejects(compilePdfDocument(h,[s,hidden]),{code:'PDF_PUBLIC_REVIEW'});
});

test('composed sections keep link-code figures in flow outside positioned boxes and caption numbering',async()=>{
 const h=header(),s=section(prose('https://example.org/composed'));s.composition=pdfCompositionDefaults(s,h.layout);
 const html=(await compilePdfDocument(h,[s])).html,nodes=[...descendants(parse(html))],figure=nodes.find(node=>hasClass(node,'pdf-link-code')),composition=nodes.find(node=>hasClass(node,'pdf-composition-page'));
 assert.ok(figure);assert.ok(composition);let node=figure;while(node){assert.equal(hasClass(node,'pdf-composition-page'),false);assert.equal(hasClass(node,'pdf-composition-item'),false);node=node.parentNode;}
 assert.ok(html.indexOf('class="pdf-link-codes"')>html.indexOf('class="pdf-composition-page"'));assert.equal(figure.parentNode.parentNode.tagName,'section');assert.doesNotMatch(html,/Figure 1/);
});

test('URL byte capacity, narrow columns and cancellation fail explicitly with selected section identity',async()=>{
 const wide=collector();assert.throws(()=>wide.observe(text('https://example.org/'+String.fromCodePoint(0xe9).repeat(503))),error=>error.code==='PDF_CAPACITY'&&error.details[0]==='selected-section');
 const budget=collector({maxBytes:100});budget.observe(text('https://example.org/a'));await assert.rejects(budget.render(),{code:'PDF_CAPACITY',details:['selected-section']});
 for(const options of [{columnWidthMm:23.9},{heightMm:23.9}]){const codes=collector(options);codes.observe(text('https://example.org/a'));await assert.rejects(codes.render(),{code:'PDF_LINK_CODE_LAYOUT',details:['selected-section']});}
 const h=header(),s=section(prose('https://example.org/a'));Object.assign(h.layout,{widthMm:90,columns:2,columnGapMm:8});await assert.rejects(compilePdfDocument(h,[s]),{code:'PDF_LINK_CODE_LAYOUT',details:[s.id]});
 const abort=new AbortController(),codes=collector({signal:abort.signal});codes.observe(text('https://example.org/a'));abort.abort();await assert.rejects(codes.render(),{name:'AbortError'});assert.throws(()=>codes.observe(text('https://example.org/b')),{name:'AbortError'});
 await assert.rejects(compilePdfDocument(header(),[s],{signal:abort.signal}),{name:'AbortError'});
});

test('multi-code generation yields to other work and observes cancellation before the next code',async()=>{
 const abort=new AbortController();let generated=0,otherWork=0;
 const codes=collector({signal:abort.signal,textGlyphs:()=>{generated++;if(generated===1)setImmediate(()=>{otherWork++;abort.abort();});}});
 for(const suffix of ['first','second','third'])codes.observe(text('https://example.org/'+suffix));
 const pending=codes.render();assert.equal(generated,1);
 await assert.rejects(pending,{name:'AbortError'});assert.equal(otherWork,1);assert.equal(generated,1);
});
