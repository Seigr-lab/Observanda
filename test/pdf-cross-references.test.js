import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseFragment} from 'parse5';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {pdfCrossReferences} from '../src/pdf-cross-references.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfStructureDefaults,pdfCaptionDefaults} from '../src/web/pdf-structure-model.js';
import {pdfSectionReviewFingerprint} from '../src/web/pdf-audience-model.js';
import {validProse,proseDocument} from '../src/web/prose-model.js';
import {renderRichText,safeRichLink} from '../src/web/rich-text-model.js';
import {createFigure} from '../src/web/figure-model.js';
import {appendPdfCrossReference,parsePdfCrossReference,pdfCrossReference,pdfCrossReferenceTargets} from '../src/web/pdf-cross-reference-model.js';
import {pdfCrossReferencesUI} from '../src/web/pdf-cross-references-ui.js';
const measuredFigure=()=>{const figure=createFigure();figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:3,error:null}];return figure;};
const header=()=>({version:1,id:randomUUID(),name:'Referenced report',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),numberSections:true,caption:{...pdfCaptionDefaults(),numberFigures:true,numberTables:true}}});
const section=(title,content='')=>({id:randomUUID(),title,content,layout:null,start:null});
const table=(title='Readings')=>({type:'book_table',attrs:{version:1,id:randomUUID(),title,headers:['Value'],rows:[['3']]}});
const image=(id=randomUUID())=>({id,asset:'a'.repeat(64),alt:'Synthetic observation',caption:'Retained image',widthMm:20,heightMm:20,fit:'contain',crop:{x:50,y:50},position:{block:0,align:'center'}});
const readImage=async asset=>({asset,mime:'image/png',content:Buffer.from('synthetic-image'),width:1,height:1});
const target=(h,s,kind,blockId=null)=>({documentId:h.id,sectionId:s.id,kind,blockId});
function links(html){const rows=[],pending=[parseFragment(html)];while(pending.length){const node=pending.pop();if(node.tagName==='a'&&node.attrs.some(attr=>attr.name==='class'&&attr.value==='pdf-cross-reference'))rows.push({href:node.attrs.find(attr=>attr.name==='href').value,text:node.childNodes.map(child=>child.value??'').join('')});for(let i=(node.childNodes?.length??0)-1;i>=0;i--)pending.push(node.childNodes[i]);}return rows;}
function memory(source=new Map()){
 const data=structuredClone(source),owner={domain:'pdf',async object(id){return structuredClone(data.get(id)??null);},async putObject(id,value){data.set(id,structuredClone(value));},async *objectIdEntries(prefix){for(const id of [...data.keys()].sort())if(id.startsWith(prefix))yield id;}};
 return {data,documents:new PdfDocumentStore(owner)};
}
function example(){
 const h=header(),a=section('Methods'),b=section('Findings'),intro=section('References'),data=table();a.images=[image()];b.images=[image()];b.content={type:'doc',content:[data]};
 for(const ref of [target(h,a,'figure',a.images[0].id),target(h,b,'table',data.attrs.id),target(h,b,'section')])intro.content=appendPdfCrossReference(intro.content,ref,'STALE NUMBER 99 \u{10000}');
 return {h,a,b,intro,data};
}

test('PDF cross-reference fragments preserve stable document/section/placement identity and ordinary rich prose validity',()=>{
 const h=header(),s=section('Measurements'),data=table(),figure=measuredFigure(),placement=randomUUID();s.figures=[figure];s.images=[image()];s.content={type:'doc',content:[data,{type:'book_figure',attrs:{version:1,id:placement,figureId:figure.id,alternative:'Trace'}}]};
 const rows=pdfCrossReferenceTargets(s,{documentId:h.id});assert.deepEqual(rows.map(row=>[row.target.kind,row.target.blockId]),[['section',null],['table',data.attrs.id],['figure',placement],['figure',s.images[0].id]]);
 for(const row of rows){const href=pdfCrossReference(row.target);assert.equal(safeRichLink(href),true);assert.deepEqual(parsePdfCrossReference(href),row.target);assert.equal(validProse(appendPdfCrossReference('',row.target,'Selected target')),true);assert.equal(parsePdfCrossReference(href+':surplus'),null);}
 const before=structuredClone(s.content),inserted=appendPdfCrossReference(s.content,rows[2].target,'Figure: Trace');assert.deepEqual(s.content,before);assert.equal(inserted.content.at(-1).content[0].text,'Figure: Trace');
 assert.equal(parsePdfCrossReference('#pdf-reference-v1:'+h.id+':'+s.id+':section:'+placement),null);assert.throws(()=>pdfCrossReference({...rows[0].target,documentId:randomUUID(),extra:true}),TypeError);
 s.images[0].id=placement;assert.equal(pdfCrossReferenceTargets(s,{documentId:h.id}).filter(row=>row.ambiguous).length,2);
});

test('retained PDF order changes recompute reference labels while historical and detached copied editions stay exact',async()=>{
 const {h,a,b,intro,data}=example();for(const value of [a,b]){const placement=value.images[0].id,figure=measuredFigure();delete value.images;value.figures=[figure];value.content={type:'doc',content:[{type:'book_figure',attrs:{version:1,id:placement,figureId:figure.id,alternative:'Retained trace'}},...proseDocument(value.content).content]};}
 const {data:storage,documents}=memory(),savedSource=structuredClone([intro,a,b]),change=(revision,operation)=>documents.change({id:h.id,commandId:randomUUID(),expectedRevision:revision,operation});
 let saved=await change(null,{type:'create',header:h,section:intro});for(const item of [a,b])saved=await change(saved.revision,{type:'append',section:item});const original=saved.revision;
 const render=async(store,revision)=>compilePdfDocument((await store.open(h.id,{revision})).header,store.content(h.id,revision),{readImage});
 const before=await render(documents,original);assert.deepEqual(links(before.html).map(row=>row.text),['Figure 1','Table 1','3 Findings']);assert.doesNotMatch(before.html,/STALE NUMBER 99|pdf-reference-v1|\uE000/);assert.ok(links(before.html)[1].href.endsWith('record-table-'+data.attrs.id));assert.ok(Object.values(before.glyphs).every(points=>!points.includes(0x10000)),'stale authored labels must not require absent glyphs');
 const moved=await change(original,{type:'move-to',sectionId:b.id,position:1}),after=await render(documents,moved.revision);assert.deepEqual(links(after.html).map(row=>row.text),['Figure 2','Table 1','2 Findings']);assert.deepEqual(links((await render(documents,original)).html),links(before.html));
 const detached=memory(storage).documents;assert.deepEqual(links((await render(detached,moved.revision)).html),links(after.html));assert.deepEqual([intro,a,b],savedSource,'compilation must not mutate retained source research');
 await assert.rejects(compilePdfDocument({...h,id:randomUUID()},[intro,a,b],{readImage}),{code:'PDF_UNRESOLVED_REFERENCE'});
 const removed=await change(moved.revision,{type:'remove-section',sectionId:a.id});await assert.rejects(render(documents,removed.revision),{code:'PDF_UNRESOLVED_REFERENCE'});assert.deepEqual(links((await render(documents,original)).html),links(before.html));
});

test('numbered references remain current with links disabled and fail for hidden, unnumbered or ambiguous targets',async()=>{
 const {h,a,b,intro}=example();for(const mode of ['document','source','destination','internal']){
  const document=structuredClone(h),sections=structuredClone([intro,a,b]);if(mode==='document')document.layout.links='disabled';if(mode==='internal')document.structure.internalLinks=false;if(mode==='source')sections[0].layout={...document.layout,links:'disabled'};if(mode==='destination'){sections[1].layout={...document.layout,links:'disabled'};sections[2].layout={...document.layout,links:'disabled'};}
  const output=await compilePdfDocument(document,sections,{readImage});assert.deepEqual(links(output.html),[]);assert.match(output.html,/Figure 1/);assert.match(output.html,/3 Findings/);assert.doesNotMatch(output.html,/STALE NUMBER/);
  await assert.rejects(compilePdfDocument(document,sections.filter(value=>value.id!==a.id),{readImage}),{code:'PDF_UNRESOLVED_REFERENCE'});
 }
 for(const kind of ['numberFigures','numberTables']){const document=structuredClone(h);document.structure.caption[kind]=false;await assert.rejects(compilePdfDocument(document,[intro,a,b],{readImage}),{code:'PDF_UNRESOLVED_REFERENCE'});}
 const document=structuredClone(h);document.structure.numberSections=false;await assert.rejects(compilePdfDocument(document,[intro,a,b],{readImage}),{code:'PDF_UNRESOLVED_REFERENCE'});
 const figure=measuredFigure(),duplicate={...a,figures:[figure],content:{type:'doc',content:[{type:'book_figure',attrs:{version:1,id:a.images[0].id,figureId:figure.id,alternative:'Duplicated identity'}}]}};await assert.rejects(compilePdfDocument(h,[intro,duplicate,b],{readImage}),{code:'PDF_UNRESOLVED_REFERENCE'});
});

test('public selection resolves only reviewed included targets and omitting the reference itself exposes no private target',async()=>{
 const {h,a,b,intro}=example();h.audience='public';const reviewed=value=>({...value,publication:{version:1,include:true,review:pdfSectionReviewFingerprint(h,value)}}),omitted=value=>({...value,publication:{version:1,include:false,review:null}});
 await assert.rejects(compilePdfDocument(h,[reviewed(intro),omitted(a),reviewed(b)],{readImage}),{code:'PDF_UNRESOLVED_REFERENCE'});
 const output=await compilePdfDocument(h,[omitted(intro),omitted(a),reviewed(b)],{readImage});assert.equal(output.sections,1);assert.match(output.html,/<h1>1 Findings<\/h1>/);assert.doesNotMatch(output.html,/Methods|STALE NUMBER|pdf-cross-reference/);
});

test('reference projection merges formatted link runs, collects derived glyphs and validates only rendered reference tokens',()=>{
 const h=header(),destination=section('Target <&>'),origin=section('Source'),blockId=randomUUID(),href=pdfCrossReference(target(h,destination,'figure',blockId)),glyphs=[];h.structure.caption.figureLabel='Figure ?';
 const mark={type:'link',attrs:{href,title:'',target:'_self',nofollow:false}},prose={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'stale ',marks:[mark,{type:'strong'}]},{type:'text',text:'number',marks:[mark,{type:'em'}]}]}]},before=structuredClone(prose),refs=pdfCrossReferences(h,{textGlyphs:(font,text)=>glyphs.push({font,text})});
 const projected=refs.project(prose,{sectionId:origin.id,layout:h.layout});refs.section(destination,{number:'2',title:'2 Target <&>'},[{sectionId:destination.id,kind:'figure',blockId,number:4,anchor:'exact-anchor'}]);
 const html=refs.finish(renderRichText(projected));assert.equal(links(html).length,1);assert.equal(links(html)[0].text,'Figure ? 4');assert.match(html,/<strong><a/);assert.deepEqual(prose,before);assert.deepEqual(glyphs,[{font:'atkinson',text:'Figure ? 4'}]);
 const unknown=pdfCrossReferences(h);unknown.project(prose,{sectionId:origin.id});assert.equal(unknown.finish('<p>Included content only</p>'),'<p>Included content only</p>');
 const malformed=appendPdfCrossReference('',target(h,destination,'section'),'Reference');malformed.content.at(-1).content[0].marks[0].attrs.href+=':forged';assert.throws(()=>refs.project(malformed,{sectionId:origin.id}),{code:'PDF_UNRESOLVED_REFERENCE'});
 const abort=new AbortController();abort.abort();assert.throws(()=>pdfCrossReferences(h,{signal:abort.signal}).project(prose,{sectionId:origin.id}),{name:'AbortError'});assert.throws(()=>pdfCrossReferences(h,{maxBytes:4}).finish('oversize'),{code:'PDF_CAPACITY'});
});

const esc=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test('reference picker pages pinned destinations and appends a valid selected reference without changing its target',async()=>{
 const h=header(),selected=section('Author'),destination=section('Late target',{type:'doc',content:Array.from({length:25},(_,i)=>table('Table '+i))}),revision='a'.repeat(64),calls=[],content=[],initial=structuredClone(destination);let document={header:h,revision},draws=0;
 const ui=pdfCrossReferencesUI({getDocument:()=>document,getSection:()=>selected,esc,text:key=>key,draw:()=>draws++,insertContent:async value=>content.push(value),post:async(name,data,{signal})=>{
  calls.push({name,data,signal});if(name==='section')return {section:destination};return {revision,query:data.query,offset:data.offset,items:[{id:destination.id,title:destination.title}],next:data.offset===0?20:null};
 }});
 await ui.action('cross-reference-search');await ui.action('cross-reference-next');assert.deepEqual(calls.map(call=>call.data.offset),[0,20]);assert.ok(calls.every(call=>call.data.revision===revision&&call.data.limit===20));
 await ui.action('cross-reference-section',{dataset:{index:'0'}});assert.match(ui.view(),/Late target/);assert.equal((ui.view().match(/data-command="cross-reference-insert"/g)??[]).length,20);await ui.action('cross-reference-targets-next');assert.equal((ui.view().match(/data-command="cross-reference-insert"/g)??[]).length,6);
 await ui.action('cross-reference-insert',{dataset:{index:'25'}});assert.equal(content.length,1);assert.equal(validProse(content[0]),true);assert.deepEqual(parsePdfCrossReference(content[0].content.at(-1).content[0].marks[0].attrs.href),target(h,destination,'table',destination.content.content[24].attrs.id));assert.deepEqual(destination,initial);
 document={...document,revision:'b'.repeat(64)};assert.doesNotMatch(ui.view(),/cross-reference-insert/);ui.dispose();assert.equal(ui.view(),'');assert.ok(draws>=3);
});

test('reference picker aborts superseded pins and never inserts an obsolete selected section',async()=>{
 const h=header(),s=section('Current'),pending=deferred();let selected={header:h,revision:'a'.repeat(64)},readSignal,draws=0;
 const ui=pdfCrossReferencesUI({getDocument:()=>selected,getSection:()=>s,esc,text:key=>key,draw:()=>draws++,insertContent:()=>assert.fail('obsolete insertion'),post:async(name,data,{signal})=>{readSignal=signal;return pending.promise;}});
 const work=ui.action('cross-reference-search');selected={...selected,revision:'b'.repeat(64)};ui.view();assert.equal(readSignal.aborted,true);pending.resolve({revision:'a'.repeat(64),items:[],next:null});await work;assert.equal(draws,0);ui.dispose();
});
