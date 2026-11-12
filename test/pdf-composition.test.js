import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfPageMasterDefaults} from '../src/web/pdf-page-master-model.js';
import {pdfCompositionArea,pdfCompositionItems,pdfCompositionDefaults,pdfAdjustComposition,pdfMoveCompositionBox,pdfCompositionStatus,validPdfComposition} from '../src/web/pdf-composition-model.js';
import {pdfCompositionUI} from '../src/web/pdf-composition-ui.js';
import {arrangeComposition,compositionMovement} from '../src/web/pdf-composition-arrange.js';
import {renderPdfComposition} from '../src/pdf-composition.js';
import {scopePdfIds} from '../src/pdf-figure-renderer.js';
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),image=(block,alt)=>({id:randomUUID(),alt,position:{block}});
const section=()=>({id:randomUUID(),title:'Guide',content:{type:'doc',content:[paragraph('First prose'),paragraph('Second prose')]},layout:null,start:null});
function composed(value=section(),layout=pdfLayoutPreset()){value.composition=pdfCompositionDefaults(value,layout);return {value,layout};}
test('multi-object layout preserves millimetres, group offsets and reading order without silently overlapping distributed boxes',()=>{
 const box=(index,xMm,widthMm)=>({target:{kind:'block',index},xMm,widthMm,yMm:index*3,heightMm:10});
 const boxes=[box(0,10,4),box(1,60,12),box(2,40,8),box(3,65,2)],area={widthMm:100,heightMm:70};
 const keys=new Set(['block:0','block:1','block:2']),values=input=>input.map(b=>b.xMm);
 assert.deepEqual(values(arrangeComposition(boxes,keys,area,{axis:'horizontal',placement:'distribute'})),[10,60,33,65]);
 assert.deepEqual(values(arrangeComposition(boxes,keys,area,{axis:'horizontal',placement:'end',relative:'page'})),[96,88,92,65]);
 const move=compositionMovement(boxes,keys,boxes[2],area,5),edits=move(90,65);
 assert.deepEqual(values(boxes.map(box=>edits.get(box)??box)),[38,88,68,65]);assert.equal(edits.size,3);
 assert.equal(move(0,0).get(boxes[2]).xMm,40);
 assert.deepEqual(values(boxes),[10,60,40,65]);assert.equal(arrangeComposition(boxes,keys,{...area,widthMm:20},{axis:'horizontal',placement:'distribute',relative:'page'}),null);
});
const content=value=>({titleHTML:value.title?'<h1>'+value.title+'</h1>':'',blocks:(value.content.content??[]).map((node,index)=>'<p id="prose-'+index+'">'+node.content[0].text+'</p>'),images:(value.images??[]).map(image=>({id:image.id,html:'<figure class="pdf-placed-image"><img alt="'+image.alt+'"><figcaption>Caption</figcaption></figure>'})),notesHTML:value.notes?.some(note=>note.kind==='footnote')?'<section class="pdf-section-notes">Section notes</section>':''});

test('composition geometry uses printable margins and gutter while keeping flow the default',()=>{
 const value=section(),layout=pdfLayoutPreset();layout.pageMaster={...pdfPageMasterDefaults(layout),facingPages:true,gutterMm:8};
 assert.equal(pdfCompositionStatus(value,layout).ready,true);assert.equal(value.composition,undefined);const area=pdfCompositionArea(layout);assert.equal(area.widthMm,162);assert.equal(area.heightMm,256.9);
 const before=structuredClone(value),composition=pdfCompositionDefaults(value,layout);assert.deepEqual(value,before);assert.equal(validPdfComposition(composition),true);value.composition=composition;assert.equal(pdfCompositionStatus(value,layout).ready,true);
 for(const patch of [{version:2},{mode:'flow'},{blockCount:-1},{gridMm:NaN},{snap:1},{unknown:true},{boxes:[composition.boxes[0],composition.boxes[0]]}])assert.equal(validPdfComposition({...composition,...patch}),false);
 for(const patch of [{xMm:-1},{widthMm:0},{heightMm:Infinity},{target:{kind:'block',index:12001}},{target:{kind:'image',id:'remote.png'}}])assert.equal(validPdfComposition({...composition,boxes:[{...composition.boxes[0],...patch}]}),false);
 const outside=structuredClone(value);outside.composition.boxes[0].xMm=1;assert.equal(validPdfComposition(outside.composition),true);assert.equal(pdfCompositionStatus(outside,layout).ready,false);assert.throws(()=>renderPdfComposition(outside,layout,content(outside)),{code:'PDF_COMPOSITION_BOUNDS'});
 assert.throws(()=>renderPdfComposition(value,{...layout,columns:2},content(value)),{code:'PDF_COMPOSITION_COLUMNS'});
});

test('physical placement and stored box order cannot change prose and image reading order',()=>{
 const value=section();value.images=[image(12000,'End image'),image(0,'Opening image'),image(1,'Middle one'),image(1,'Middle two')];value.notes=[{id:randomUUID(),kind:'footnote',block:1,content:'Footnote'}];const {layout}=composed(value),original=structuredClone({content:value.content,images:value.images});
 const keys=['title','image:'+value.images[1].id,'block:0','image:'+value.images[2].id,'image:'+value.images[3].id,'block:1','image:'+value.images[0].id,'notes'];assert.deepEqual(pdfCompositionItems(value).map(item=>item.key),keys);
 value.composition.boxes.reverse();for(const [index,box] of value.composition.boxes.entries()){box.xMm=index%2*70;box.yMm=index*25;box.widthMm=60;box.heightMm=20;}
 const output=renderPdfComposition(value,layout,{...content(value),references:[{block:1,html:'<sup id="reference-one"><a href="#prose-0">1</a></sup>'}]});assert.deepEqual(output.targets.map(item=>item.key),keys);assert.deepEqual({content:value.content,images:value.images},original);
 let at=-1;for(const key of keys){const next=output.html.indexOf('data-pdf-composition-key="'+key+'"');assert.ok(next>at);at=next;}
 assert.ok(output.html.indexOf('First prose')<output.html.indexOf('reference-one'));assert.ok(output.html.indexOf('reference-one')<output.html.indexOf('Middle one'));assert.ok(output.html.indexOf('Second prose')<output.html.indexOf('End image'));
 assert.equal(output.html.includes('overflow:hidden'),false);assert.match(output.css,/overflow:visible/);assert.match(output.css,/column-count:1!important/);assert.match(output.css,/height:0!important;min-height:0;flex:1 1 auto/);
 const scoped=scopePdfIds(output.html,'owned-');assert.match(scoped,/id="owned-prose-0"/);assert.match(scoped,/href="#owned-prose-0"/);assert.equal(scoped.includes('owned-owned-'),false);
});

test('changed block or image membership remains explicitly stale until an adjustment',()=>{
 const {value,layout}=composed(),original=structuredClone(value.composition);value.content.content.push(paragraph('New block'));
 assert.equal(validPdfComposition(value.composition),true);assert.deepEqual(value.composition,original);assert.equal(pdfCompositionStatus(value,layout).ready,false);assert.throws(()=>renderPdfComposition(value,layout,content(value)),{code:'PDF_COMPOSITION_STALE'});
 value.composition=pdfAdjustComposition(value,layout);assert.equal(value.composition.blockCount,3);assert.equal(pdfCompositionStatus(value,layout).ready,true);assert.deepEqual(value.composition.boxes[0],original.boxes[0]);
 value.images=[image(1,'New image')];assert.equal(pdfCompositionStatus(value,layout).ready,false);value.composition=pdfAdjustComposition(value,layout);assert.equal(pdfCompositionStatus(value,layout).ready,true);
 const removed=value.images[0].id;value.images=[];assert.equal(pdfCompositionStatus(value,layout).ready,false);value.composition=pdfAdjustComposition(value,layout);assert.equal(value.composition.boxes.some(box=>box.target.id===removed),false);
 const wrong=content(value);wrong.blocks.pop();assert.throws(()=>renderPdfComposition(value,layout,wrong),{code:'PDF_COMPOSITION_STALE'});assert.throws(()=>renderPdfComposition(value,layout,{...content(value),images:[{id:randomUUID(),html:'<img>'}]}),{code:'PDF_COMPOSITION_STALE'});
});

test('overlap is reported without hiding content; touching edges and intentional empty pages remain valid',()=>{
 const {value,layout}=composed();value.composition.boxes=value.composition.boxes.map((box,index)=>({...box,xMm:index*40,yMm:0,widthMm:40,heightMm:30}));assert.equal(pdfCompositionStatus(value,layout).issues.length,0);
 value.composition.boxes[1].xMm=20;const status=pdfCompositionStatus(value,layout);assert.equal(status.ready,true);assert.equal(status.issues[0].code,'PDF_COMPOSITION_OVERLAP');const output=renderPdfComposition(value,layout,content(value));assert.equal(output.findings[0].severity,'warning');assert.match(output.html,/data-pdf-composition-overlap="true"/);assert.match(output.html,/First prose/);assert.match(output.html,/Second prose/);
 const blank={id:randomUUID(),title:'',content:'',images:[]};blank.composition=pdfCompositionDefaults(blank,layout);const page=renderPdfComposition(blank,layout,{blocks:['<p></p>']});assert.equal(page.targets.length,1);assert.equal(page.heightMm,pdfCompositionArea(layout).heightMm);assert.match(page.html,/height:256.9mm/);
 const controller=new AbortController();controller.abort();assert.throws(()=>renderPdfComposition(value,layout,{...content(value),signal:controller.signal}),{name:'AbortError'});
});

const element=(attributes=[],dataset={},value='',checked=false)=>({dataset,value,checked,invalid:false,hasAttribute:name=>attributes.includes(name),setAttribute(name){if(name==='aria-invalid')this.invalid=true;},removeAttribute(name){if(name==='aria-invalid')this.invalid=false;}});
test('composition authoring has physical controls and explicit mode/adjust actions without changing document layout',()=>{
 const document={header:{id:randomUUID(),layout:{...pdfLayoutPreset(),columns:3}}},value=section(),original=structuredClone(document);let changes=0,draws=0;const ui=pdfCompositionUI({esc:String,getDocument:()=>document,getSection:()=>value,changed:()=>changes++,draw:()=>draws++});
 assert.match(ui.view(),/data-pdf-composition-mode/);assert.equal(changes,0);ui.input(element(['data-pdf-composition-mode'],{},'page'));assert.equal(value.layout.columns,1);assert.deepEqual(document,original);assert.equal(changes,1);assert.match(ui.view(),/data-pdf-composition-handle="block:0"/);
 const bad=element([],{pdfCompositionField:'xMm',pdfCompositionKey:'block:0'},'1000');ui.input(bad);assert.equal(bad.invalid,true);assert.equal(changes,1);
 ui.input(element([],{pdfCompositionField:'widthMm',pdfCompositionKey:'block:0'},'40'));ui.input(element([],{pdfCompositionField:'xMm',pdfCompositionKey:'block:0'},'12.5'));assert.equal(value.composition.boxes.find(box=>box.target.index===0).xMm,12.5);
 const moved=pdfMoveCompositionBox(value,value.layout,'block:0',{xMm:13,yMm:9999});assert.equal(moved.boxes.find(box=>box.target.index===0).xMm,15);assert.ok(moved.boxes.find(box=>box.target.index===0).yMm+moved.boxes.find(box=>box.target.index===0).heightMm<=pdfCompositionArea(value.layout).heightMm+1e-7);
 value.content.content.push(paragraph('Unplaced'));assert.equal(pdfCompositionStatus(value,value.layout).ready,false);ui.action('composition-adjust');assert.equal(pdfCompositionStatus(value,value.layout).ready,true);ui.input(element(['data-pdf-composition-mode'],{},'flow'));assert.equal(value.composition,undefined);assert.equal(ui.action('other'),false);assert.ok(draws>=3);ui.dispose();
});

test('canvas handles support bounded arrow movement, drag cancellation and context-safe commits',()=>{
 let value=section();const document={header:{id:randomUUID(),layout:pdfLayoutPreset()}};value.composition=pdfCompositionDefaults(value,document.header.layout);const box=value.composition.boxes.find(box=>box.target.kind==='block'&&box.target.index===0);Object.assign(box,{xMm:10,yMm:20,widthMm:40,heightMm:30});let changes=0;
 const ui=pdfCompositionUI({esc:String,getDocument:()=>document,getSection:()=>value,changed:()=>changes++,draw:()=>{},isSaved:()=>false,getPreflight:()=>null});
 ui.view();
 const handlers=new Map(),status={},ownerDocument={hidden:false,addEventListener(){}};
 const canvas={dataset:{},style:{},getBoundingClientRect:()=>({width:170,height:256.9}),querySelectorAll:()=>[container],querySelector:()=>null,closest:()=>null};
 const container={dataset:{pdfCompositionBox:'block:0'},style:{},parentElement:canvas};
 const node={dataset:{pdfCompositionHandle:'block:0'},parentElement:container,firstElementChild:{},hasAttribute:()=>false,setAttribute(){},focus(){},setPointerCapture(){},closest(selector){return selector.includes('[data-pdf-composition-handle]')?this:null;}};
 container.firstElementChild=node;
 const host={ownerDocument,querySelector:selector=>selector==='[data-pdf-composition-canvas]'?canvas:status,addEventListener(name,fn,{signal}){handlers.set(name,fn);signal.addEventListener('abort',()=>{if(handlers.get(name)===fn)handlers.delete(name);});}};
 const event=extra=>({target:node,preventDefault(){},stopPropagation(){},...extra});ui.bind(host);
 handlers.get('keydown')(event({key:'ArrowRight'}));assert.equal(value.composition.boxes.find(box=>box.target.index===0).xMm,15);assert.equal(changes,1);
 handlers.get('pointerdown')(event({button:0,pointerId:7,clientX:0,clientY:0}));handlers.get('pointermove')(event({pointerId:7,clientX:10,clientY:5}));assert.equal(changes,1);handlers.get('keydown')(event({key:'Escape'}));assert.equal(value.composition.boxes.find(box=>box.target.index===0).xMm,15);assert.equal(changes,1);
 handlers.get('pointerdown')(event({button:0,pointerId:8,clientX:0,clientY:0}));handlers.get('pointermove')(event({pointerId:8,clientX:10,clientY:5}));handlers.get('pointerup')(event({pointerId:8}));assert.equal(changes,2);assert.equal(value.composition.boxes.find(box=>box.target.index===0).xMm,25);
 const previous=value;value=section();handlers.get('keydown')(event({key:'ArrowRight'}));assert.equal(changes,2);assert.equal(previous.composition.boxes.find(box=>box.target.index===0).xMm,25);ui.dispose();assert.equal(handlers.size,0);
});
