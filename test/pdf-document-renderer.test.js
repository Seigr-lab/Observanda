import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pdfLayoutPreset,validPdfLayout} from '../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../src/pdf-font-assets.js';
const header=()=>({version:1,id:randomUUID(),name:'Research report',language:'en',direction:'ltr',layout:pdfLayoutPreset()});
const section=(content='Exact observation')=>({id:randomUUID(),title:'Results',content,layout:null,start:null});
const linked={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Source',marks:[{type:'link',attrs:{href:'https://example.org/result',title:'',target:'_self',nofollow:false}}]}]},{type:'book_citation',attrs:{version:1,id:randomUUID(),title:'Cited result',authors:'An author',issued:'2026',locator:'p. 2',url:'https://example.org/citation'}}]};
test('PDF layouts preserve custom physical dimensions and reject unusable content areas',()=>{
 const layout=pdfLayoutPreset('print');Object.assign(layout,{widthMm:230,heightMm:170,columns:2,columnGapMm:7,fontSizePt:12.5});
 assert.equal(validPdfLayout(layout),true);assert.equal(layout.links,'disabled');layout.margins.left=200;assert.equal(validPdfLayout(layout),false);layout.margins.left=20;layout.columns=1.5;assert.equal(validPdfLayout(layout),false);
});
test('PDF compilation preserves ordered content, custom sections and explicit page starts',async()=>{
 const h=header(),first=section('FIRST 9007199254740993'),second=section('SECOND'),wide={...pdfLayoutPreset(),widthMm:297,heightMm:210};second.layout=wide;second.start='recto';
 const result=await compilePdfDocument(h,(async function*(){yield first;yield second;})());
 assert.equal(result.sections,2);assert.ok(result.html.indexOf('FIRST')<result.html.indexOf('SECOND'));assert.match(result.html,/9007199254740993/);assert.match(result.html,/size:297mm 210mm/);assert.match(result.html,/data-start="recto"/);assert.match(result.html,/table-header-group/);
 const embedded=await embedPdfFonts(result);assert.match(embedded.html,/data:font\/ttf;base64,/);assert.ok(embedded.fontBytes>0);
});
test('print link policy removes prose and citation links without removing their readable text',async()=>{
 const h=header(),s=section(linked);h.layout.links='disabled';const output=await compilePdfDocument(h,[s]);
 assert.doesNotMatch(output.html,/<a\b|https:\/\/example\.org/);assert.match(output.html,/Source/);assert.match(output.html,/Cited result/);
 const enabled=await compilePdfDocument(header(),[s]);assert.match(enabled.html,/<a href="https:\/\/example.org\/result"/);assert.match(enabled.html,/<a href="https:\/\/example.org\/citation"/);
});
test('PDF input rejects unresolved research, figures, duplicate identities and unavailable fonts',async()=>{
 const h=header(),s=section();await assert.rejects(compilePdfDocument(h,[s,s]),{code:'PDF_SECTION'});
 h.layout.font='editorial';await assert.rejects(compilePdfDocument(h,[s]),{code:'PDF_FONT'});h.layout.font='atkinson';
 s.content={type:'doc',content:[{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:randomUUID(),alternative:'A result'}}]};await assert.rejects(compilePdfDocument(h,[s]),{code:'PDF_UNRESOLVED_FIGURE'});
 await assert.rejects(compilePdfDocument(h,[]),{code:'PDF_EMPTY'});
});
test('PDF compilation escapes text and stops bounded input or cancellation without consuming later sections',async()=>{
 const h=header();h.name='</title><script>bad()</script>';h.layout.header='</style><script>bad()</script>';
 const output=await compilePdfDocument(h,[section('<img src="file:///private">')]);assert.doesNotMatch(output.html,/<script>|<img /);assert.match(output.html,/&lt;img/);
 let visited=0;await assert.rejects(compilePdfDocument(header(),(async function*(){visited++;yield section('x'.repeat(3000));visited++;yield section();})(),{maxBytes:2000}),{code:'PDF_CAPACITY'});assert.equal(visited,1);
 const controller=new AbortController();controller.abort();await assert.rejects(compilePdfDocument(header(),[section()],{signal:controller.signal}),{name:'AbortError'});
});

test('PDF font preflight rejects unsupported glyphs and accepts an explicit Arabic font',async()=>{
 const h=header();await assert.rejects(embedPdfFonts(await compilePdfDocument(h,[section('\u6587\u5b57')])),{code:'PDF_GLYPH'});
 h.layout.font='aref-ruqaa-ink';h.direction='rtl';h.language='ar';const arabic=section('\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645');arabic.title='';const output=await embedPdfFonts(await compilePdfDocument(h,[arabic]));assert.match(output.html,/dir="rtl"/);assert.ok(output.fontBytes>0);
});
