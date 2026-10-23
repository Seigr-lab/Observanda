import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {createFigure,createSeries} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {validAuthoredPointOrigin} from '../src/web/retained-figure-authoring-model.js';
import {figureCalculationFingerprint} from '../src/record-figure-calculation.js';
import {validRetainedFigure} from '../src/web/retained-figure-model.js';
const fixture=()=>{const files=new Map();let reads=0;return {files,get reads(){return reads;},reset(){reads=0;},workspace:{async readMetadata(name){reads++;return files.get(name)??null;},async writeMetadata(name,value){files.set(name,value);}}};};
const rows=async(owner,figure,collection,scope={})=>(await (await owner.open(figure)).window({collection,...scope,limit:128})).items;
const json=async reader=>{let text='';for await(const part of reader.json())text+=part;return JSON.parse(text);};
test('manual drafts keep incomplete indexed values private until exact strict finish',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),id=randomUUID();let draft=await owner.start(null,{id});
 assert.ok(validRetainedFigure(draft,{draft:true}));assert.equal(validRetainedFigure(draft),false);assert.equal(draft.document.counts.points,0);
 await assert.rejects(new RetainedFigureDocuments(f.workspace).open(draft),{code:'MATERIAL_INVALID'});await assert.rejects(json(await owner.open(draft)),{code:'MATERIAL_INVALID'});await assert.rejects(owner.finish(draft),{code:'MATERIAL_INVALID'});
 const [panel]=await rows(owner,draft,'panels'),[series]=await rows(owner,draft,'series');
 draft=await owner.change(draft,{type:'append',collection:'points',plotId:panel.plotId,seriesId:series.id,value:{x:null,y:null,error:null}});await owner.verify(draft);
 const [point]=await rows(owner,draft,'points');const incomplete=draft;
 draft=await owner.change(draft,{type:'patch',collection:'points',plotId:panel.plotId,id:point.id,patch:{x:1,y:2}});
 const saved=await owner.finish(draft);assert.ok(validRetainedFigure(saved));assert.equal(saved.id,id);await owner.verify(saved);assert.deepEqual((await json(await owner.open(saved))).series[0].points,[{x:1,y:2,error:null}]);
 assert.equal((await rows(owner,incomplete,'points'))[0].value.x,null);assert.equal((await rows(owner,draft,'points'))[0].id,point.id);
 const readonly=new RetainedFigureAuthoring(f.workspace,{readOnly:true});await readonly.verify(draft);await assert.rejects(readonly.change(draft,{type:'patch',collection:'points',plotId:panel.plotId,id:point.id,patch:{y:3}}),{code:'MATERIAL_INVALID'});
});
test('selected point edits preserve untouched receipts, text nodes and complete old revisions',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),figure=createFigure();figure.x.kind='category';const long='Category '+ '\u03bb\ud83d\ude00'.repeat(40000);figure.series[0].points=[];
 const builder=documents.builder(figure);await builder.addPlot(figure);await builder.addSeries(figure.series[0]);
 const receipt={version:1,row:10,column:2};let last;
 for(let n=0;n<257;n++)last=await builder.addPoint({x:n===256?long:'Category '+n,y:n,error:null},{source:receipt});
 const saved=await builder.finish(),owner=new RetainedFigureAuthoring(f.workspace);let draft=await owner.start(saved);const plotId=figure.id;
 f.reset();draft=await owner.change(draft,{type:'text',collection:'points',plotId,id:last.id,field:'x',offset:100000,remove:2,text:'ZZ'});assert.ok(f.reads<160,'selected splice follows bounded nodes instead of all points');
 const reader=await owner.open(draft),tail=await reader.item({collection:'points',id:last.id});assert.equal(tail.value.x.characters,long.length);assert.equal(tail.value.source,undefined);assert.deepEqual((await reader.window({collection:'points',limit:1})).items[0].value.source,receipt);
 const slice=await reader.text({collection:'points',id:last.id,field:'x',offset:99998,limit:8});assert.equal(slice.text,(long.slice(0,100000)+'ZZ'+long.slice(100002)).slice(99998,100006));
 const complete=await owner.finish(draft);await owner.verify(complete);assert.equal(complete.document.counts.points,257);assert.deepEqual((await (await documents.open(saved)).item({collection:'points',id:last.id})).value.source,receipt);
 draft=await owner.change(draft,{type:'text',collection:'points',plotId,id:last.id,field:'x',offset:0,remove:long.length,text:'Short'});assert.equal((await (await owner.open(draft)).item({collection:'points',id:last.id})).value.x,'Short');await owner.verify(await owner.finish(draft));
});
test('draft structural edits retain stable IDs, cascade removals, imports and panel order',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace);let draft=await owner.start(null,{kind:'panels'});assert.equal((await (await owner.open(draft)).header()).counts.panels,0);await owner.verify(draft);
 for(const label of ['One','Two'])draft=await owner.change(draft,{type:'append',collection:'panels',value:{label,kind:'line',xKind:'number'}});
 const panels=await rows(owner,draft,'panels');for(const panel of panels){const [series]=await rows(owner,draft,'series',{plotId:panel.plotId});for(let n=0;n<3;n++)draft=await owner.change(draft,{type:'append',collection:'points',plotId:panel.plotId,seriesId:series.id,value:{x:n,y:n,error:null}});}
 const points=await rows(owner,draft,'points',{plotId:panels[0].plotId});draft=await owner.change(draft,{type:'move',collection:'points',plotId:panels[0].plotId,id:points[2].id,direction:-1});assert.deepEqual((await rows(owner,draft,'points',{plotId:panels[0].plotId})).map(row=>row.id),[points[0].id,points[2].id,points[1].id]);
 draft=await owner.change(draft,{type:'move',collection:'panels',id:panels[1].id,direction:-1});assert.deepEqual((await rows(owner,draft,'panels')).map(row=>row.id),panels.map(row=>row.id).reverse());
 await owner.verify(draft);const complete=await owner.finish(draft);await owner.verify(complete);
 draft=await owner.change(draft,{type:'remove',collection:'panels',id:panels[0].id});assert.equal(draft.document.counts.points,3);await owner.verify(draft);await assert.rejects(owner.finish(draft),{code:'MATERIAL_INVALID'});
 draft=await owner.import(draft,complete,{mode:'panel'});assert.equal(draft.document.counts.panels,3);assert.equal(draft.document.counts.points,9);await owner.verify(draft);await owner.verify(await owner.finish(draft));
 const removed=(await rows(owner,draft,'series'))[0];draft=await owner.change(draft,{type:'remove',collection:'series',id:removed.id,plotId:removed.plotId});await owner.verify(draft);await assert.rejects(owner.finish(draft),{code:'MATERIAL_INVALID'});
});
test('manual presentation and type changes preserve entered values and reject incompatible finish',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),inline=createFigure();inline.series[0].points=[{x:1,y:2,error:null}];let draft=await owner.start(inline);
 draft=await owner.change(draft,{type:'text',collection:'header',id:draft.id,field:'title',offset:0,remove:11,text:'Authored title'});assert.equal(draft.title,'Authored title');
 draft=await owner.change(draft,{type:'patch',collection:'header',id:draft.id,patch:{x:{kind:'category'}}});assert.equal((await rows(owner,draft,'points'))[0].value.x,1);await assert.rejects(owner.finish(draft),{code:'MATERIAL_INVALID'});
 draft=await owner.change(draft,{type:'patch',collection:'header',id:draft.id,patch:{x:{kind:'number'}}});await owner.verify(await owner.finish(draft));
 const before=f.files.size,abort=new AbortController();abort.abort();await assert.rejects(new RetainedFigureAuthoring(f.workspace,{signal:abort.signal}).finish(draft),{name:'AbortError'});assert.equal(f.files.size,before);
});

test('callouts keep their exact measurement across moves and refuse destructive referenced deletes',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),inline=createFigure(),series=inline.series[0];series.points=[{x:0,y:2,error:null},{x:1,y:3,error:null},{x:2,y:4,error:null}];
 inline.annotations=[{id:randomUUID(),kind:'callout',label:'Exact observation',color:'#123456',opacity:.5,seriesId:series.id,pointIndex:2,dx:24,dy:-36}];let draft=await owner.start(inline),points=await rows(owner,draft,'points');
 draft=await owner.change(draft,{type:'move',collection:'points',plotId:inline.id,id:points[2].id,direction:-1});assert.equal((await rows(owner,draft,'annotations'))[0].value.pointIndex,1);
 await assert.rejects(owner.change(draft,{type:'remove',collection:'points',plotId:inline.id,id:points[2].id}),{code:'MATERIAL_INVALID'});await assert.rejects(owner.change(draft,{type:'remove',collection:'series',plotId:inline.id,id:series.id}),{code:'MATERIAL_INVALID'});
 draft=await owner.change(draft,{type:'remove',collection:'points',plotId:inline.id,id:points[0].id});assert.equal((await rows(owner,draft,'annotations'))[0].value.pointIndex,0);const saved=await owner.finish(draft);await owner.verify(saved);assert.equal((await rows(owner,saved,'points'))[0].id,points[2].id);
 draft=await owner.change(draft,{type:'remove',collection:'annotations',id:inline.annotations[0].id,plotId:inline.id});draft=await owner.change(draft,{type:'remove',collection:'points',plotId:inline.id,id:points[2].id});await owner.verify(await owner.finish(draft));
});
test('strict finish validates complete ticks, logarithmic bounds, linked panels and copied wrapper identity',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),documents=new RetainedFigureDocuments(f.workspace),inline=createFigure();inline.series[0].points=[{x:1,y:2,error:3}];let draft=await owner.start(inline);
 draft=await owner.change(draft,{type:'patch',collection:'header',id:draft.id,patch:{y:{scale:'log'}}});await assert.rejects(owner.finish(draft),{code:'MATERIAL_INVALID'});draft=await owner.change(draft,{type:'patch',collection:'header',id:draft.id,patch:{y:{scale:'linear'}}});
 draft=await owner.change(draft,{type:'append',collection:'ticks',plotId:inline.id,value:{axis:'x',value:1,label:' '}});await assert.rejects(owner.finish(draft),{code:'MATERIAL_INVALID'});
 const tick=(await rows(owner,draft,'ticks'))[0];draft=await owner.change(draft,{type:'patch',collection:'ticks',id:tick.id,plotId:inline.id,patch:{label:'Tick'}});const saved=await owner.finish(draft);await owner.verify(saved);
 const nextId=randomUUID(),copy=await owner.start({...saved,title:'Copied title'},{id:nextId});const completed=await owner.finish(copy);assert.equal(completed.id,nextId);assert.equal(completed.title,'Copied title');assert.equal((await json(await documents.open(completed))).title,'Copied title');
 let panels=await owner.start(null,{kind:'panels'});panels=await owner.import(panels,saved,{mode:'panel'});panels=await owner.import(panels,saved,{mode:'panel'});const list=await rows(owner,panels,'panels');
 panels=await owner.change(panels,{type:'patch',collection:'header',id:panels.id,patch:{layout:{linkX:true}}});panels=await owner.change(panels,{type:'patch',collection:'header',plotId:list[1].plotId,patch:{x:{label:'Different'}}});await assert.rejects(owner.finish(panels),{code:'MATERIAL_INVALID'});
});

test('authored imports bind original analysis point identities and preserve them until a real edit',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),inline=createFigure(),ref={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)},builder=documents.builder(inline);await builder.addPlot(inline);await builder.addSeries(inline.series[0]);
 const receipt={version:2,column:2,group:null,coordinates:{},source:{page:1,row:2}},original=await builder.addPoint({x:1,y:2,error:null},{source:receipt}),stored={...await builder.finish(),source:ref},owner=new RetainedFigureAuthoring(f.workspace);let draft=await owner.start(stored);
 const origin={ref,seriesId:inline.series[0].id,pointId:original.id};assert.deepEqual((await rows(owner,draft,'points'))[0].value.source,{...receipt,origin});await owner.verify(draft);
 draft=await owner.change(draft,{type:'patch',collection:'points',plotId:inline.id,id:original.id,patch:{y:2}});assert.deepEqual((await rows(owner,draft,'points'))[0].value.source,{...receipt,origin});
 const saved=await owner.finish(draft);assert.equal(saved.source,undefined);await owner.verify(saved);let copy=await owner.start(null,{kind:'panels'});copy=await owner.import(copy,stored,{mode:'panel'});copy=await owner.import(copy,saved,{mode:'panel'});const points=await rows(owner,copy,'points');assert.equal(points.length,2);assert.notEqual(points[0].id,original.id);assert.notEqual(points[1].id,original.id);for(const point of points)assert.deepEqual(point.value.source,{...receipt,origin});
 await owner.verify(await owner.finish(copy));draft=await owner.change(draft,{type:'patch',collection:'points',plotId:inline.id,id:original.id,patch:{y:3}});assert.equal((await rows(owner,draft,'points'))[0].value.source,undefined);assert.deepEqual((await rows(owner,saved,'points'))[0].value.source,{...receipt,origin});
 const malformed=documents.builder(inline);await malformed.addPlot(inline);await malformed.addSeries(inline.series[0]);await malformed.addPoint({x:1,y:2,error:null},{source:{...receipt,origin:{...origin,pointId:'wrong'}}});await assert.rejects(owner.verify(await malformed.finish()),{code:'MATERIAL_MISSING'});
});

test('replacing a long point label with a short value never materializes the old string',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),inline=createFigure();inline.x.kind='category';inline.series[0].points=[{x:'Large '+ 'x'.repeat(200000),y:2,error:null}];const original=await owner.start(inline),point=(await rows(owner,original,'points'))[0],read=RecordValueTree.prototype.read;
 let changed;RecordValueTree.prototype.read=async function(revision){const node=await this.node(revision);if(node.type==='string'&&node.bytes>16384)throw Error('Unexpected whole long-string read');return read.call(this,revision);};
 try{changed=await owner.change(original,{type:'patch',collection:'points',id:point.id,plotId:inline.id,patch:{x:'Short'}});}finally{RecordValueTree.prototype.read=read;}
 assert.equal((await rows(owner,changed,'points'))[0].value.x,'Short');assert.equal((await rows(owner,original,'points'))[0].value.x.characters,200006);await owner.verify(await owner.finish(changed));
});


test('inline conversion binds exact flattened source ordinals and respects child source scopes',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),ref={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},childRef={kind:'analysis',id:randomUUID(),revision:'c'.repeat(64)},prior={ref:childRef,index:9},inline=createFigure();
 inline.source=ref;inline.series[0].points=[{x:0,y:1,error:null},{x:1,y:2,error:null,source:{origin:prior}}];const second=createSeries('Second',1);second.points=[{x:2,y:3,error:null},{x:3,y:4,error:null}];inline.series.push(second);
 let draft=await owner.start(inline);const points=await rows(owner,draft,'points');assert.deepEqual(points.map(point=>point.value.source.origin),[{ref,index:0},prior,{ref,index:2},{ref,index:3}]);await owner.verify(draft);
 draft=await owner.change(draft,{type:'patch',collection:'points',plotId:inline.id,id:points[2].id,patch:{y:3}});assert.deepEqual((await rows(owner,draft,'points'))[2].value.source.origin,{ref,index:2});
 const saved=await owner.finish(draft);await owner.verify(saved);draft=await owner.change(draft,{type:'patch',collection:'points',plotId:inline.id,id:points[2].id,patch:{y:5}});assert.equal((await rows(owner,draft,'points'))[2].value.source,undefined);assert.deepEqual((await rows(owner,saved,'points'))[2].value.source.origin,{ref,index:2});
 const a=createFigure(),b=createFigure();a.series[0].points=[{x:0,y:1,error:null},{x:1,y:2,error:null}];b.source=childRef;b.series[0].points=[{x:2,y:3,error:null}];const bs=createSeries('Second',1);bs.points=[{x:3,y:4,error:null}];b.series.push(bs);const panels={...createComposition([a,b]),source:ref},combined=await owner.start(panels);
 assert.deepEqual((await rows(owner,combined,'points')).map(point=>point.value.source.origin),[{ref,index:0},{ref,index:1},{ref:childRef,index:0},{ref:childRef,index:1}]);await owner.verify(await owner.finish(combined));
 for(const invalid of [{ref,index:-1},{ref,index:Number.MAX_SAFE_INTEGER+1},{ref,index:0,seriesId:randomUUID(),pointId:randomUUID()}])assert.equal(validAuthoredPointOrigin(invalid),false);
 const documents=new RetainedFigureDocuments(f.workspace),builder=documents.builder(a);await builder.addPlot(a);await builder.addSeries(a.series[0]);await builder.addPoint({x:1,y:2,error:null},{source:{origin:{ref,index:-1}}});await assert.rejects(owner.verify(await builder.finish()),{code:'MATERIAL_MISSING'});
});


test('mixed retained compositions preserve child targets and extract exact selected plots',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),owner=new RetainedFigureAuthoring(f.workspace),inline=createFigure();inline.series[0].points=[{x:1,y:2,error:null},{x:2,y:3,error:null}];inline.annotations=[{id:randomUUID(),kind:'callout',label:'Exact second',color:'#123456',opacity:.5,seriesId:inline.series[0].id,pointIndex:1,dx:24,dy:-36}];const saved=await documents.retain(inline),other=createFigure();other.series[0].points=[{x:4,y:5,error:null}];const mixed=createComposition([saved,saved,other]),before=structuredClone(mixed),draft=await owner.start(mixed),complete=await owner.finish(draft),panels=await rows(owner,complete,'panels');
 assert.deepEqual(panels.map(panel=>panel.plotId),mixed.panels.map(panel=>panel.figure.id));assert.deepEqual(panels.map(panel=>panel.id),mixed.panels.map(panel=>panel.id));assert.equal(new Set((await rows(owner,complete,'series')).map(series=>series.id)).size,3);await owner.verify(complete);assert.deepEqual(mixed,before);
 const selected=await owner.extract(complete,panels[1].plotId),selectedJSON=await json(await owner.open(selected));assert.equal(selected.id,panels[1].plotId);assert.deepEqual(selectedJSON.series[0].points,inline.series[0].points);assert.equal(selectedJSON.annotations[0].pointIndex,1);await owner.verify(selected);
 const alias={...saved,id:randomUUID(),title:'Alias title'},extractedAlias=await owner.extract(alias,alias.id);assert.equal(extractedAlias.id,alias.id);assert.equal(extractedAlias.title,alias.title);assert.deepEqual((await json(await owner.open(extractedAlias))).series[0].points,inline.series[0].points);
 const fingerprint=await figureCalculationFingerprint(f.workspace,inline),selectedFingerprint=await figureCalculationFingerprint(f.workspace,complete,{plotId:panels[1].plotId});assert.equal(fingerprint,selectedFingerprint);
 const styled=structuredClone(inline);styled.title='Presentation only';styled.series[0].color='#abcdef';assert.equal(await figureCalculationFingerprint(f.workspace,styled),fingerprint);styled.series[0].points[1].y++;assert.notEqual(await figureCalculationFingerprint(f.workspace,styled),fingerprint);
 const category=createFigure();category.x.kind='category';category.series[0].points=[{x:'Exact '+ '\u03bb\ud83d\ude00'.repeat(10000),y:4,error:null}];const retainedCategory=await owner.finish(await owner.start(category));assert.equal(await figureCalculationFingerprint(f.workspace,category),await figureCalculationFingerprint(f.workspace,retainedCategory));const tickless={...category,x:{...category.x,ticks:[]}};assert.equal(await figureCalculationFingerprint(f.workspace,tickless),await figureCalculationFingerprint(f.workspace,category));
 const mapping=[],target=await owner.start(null,{kind:'plot'}),replacement=await owner.import(target,complete,{mode:'replace',sourcePlotId:panels[1].plotId,onMapped:value=>mapping.push(value)});assert.deepEqual(mapping,[{sourceId:panels[1].plotId,targetId:target.id}]);assert.deepEqual((await json(await owner.open(await owner.finish(replacement)))).series[0].points,inline.series[0].points);await assert.rejects(owner.extract(complete,randomUUID()),{code:'MATERIAL_INVALID'});
});


test('manual counted markers can be disabled without dropping counts or prior settings',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),inline=createFigure();inline.series[0].points=[{x:1,y:2,error:null}];let draft=await owner.start(inline);
 const markerArea={unitArea:24,label:'Declared count '.repeat(100)},patch=value=>({type:'patch',collection:'header',id:draft.id,patch:{markerArea:value}});
 draft=await owner.change(draft,patch(markerArea));await owner.verify(draft);await assert.rejects(owner.finish(draft),{code:'MATERIAL_INVALID'});
 const point=(await rows(owner,draft,'points'))[0];draft=await owner.change(draft,{type:'patch',collection:'points',plotId:inline.id,id:point.id,patch:{count:4}});const enabled=await owner.finish(draft);await owner.verify(enabled);
 draft=await owner.change(draft,patch(null));await owner.verify(draft);const disabled=await owner.finish(draft),value=await json(await owner.open(disabled));assert.equal(value.markerArea,undefined);assert.equal(value.series[0].points[0].count,4);await owner.verify(disabled);assert.deepEqual((await json(await owner.open(enabled))).markerArea,markerArea);
 const again=await owner.change(draft,patch(null));await owner.verify(again);assert.equal((await json(await owner.open(await owner.finish(again)))).markerArea,undefined);
 const other=createFigure();other.series[0].points=[{x:3,y:4,error:null}];let panels=await owner.start(createComposition([enabled,other]));const selected=(await rows(owner,panels,'panels'))[0];panels=await owner.change(panels,{type:'patch',collection:'header',id:selected.plotId,plotId:selected.plotId,patch:{markerArea:null}});await owner.verify(panels);const complete=await owner.finish(panels);await owner.verify(complete);const children=await json(await owner.open(complete));assert.equal(children.panels[0].figure.markerArea,undefined);assert.equal(children.panels[0].figure.series[0].points[0].count,4);
});


test('retained duplication remaps complete composition targets and preserves original point origins',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),a=createFigure(),b=createFigure();a.series[0].points=[{x:1,y:2,error:null}];b.series[0].points=[{x:3,y:4,error:null}];const composition=createComposition([a,b]);composition.panels[0].label='Complete label '+ '\u03bb'.repeat(5000);const retained=await owner.finish(await owner.start(composition)),ref={kind:'analysis',id:randomUUID(),revision:'d'.repeat(64)},source={...retained,source:ref},before=await rows(owner,source,'panels'),mapped=[];
 const copy=await owner.duplicate(source,{onMapped:pair=>mapped.push(pair)}),after=await rows(owner,copy,'panels');await owner.verify(copy);assert.notEqual(copy.id,source.id);assert.equal(copy.source,undefined);assert.equal(mapped.length,3);assert.deepEqual(mapped.at(-1),{sourceId:source.id,targetId:copy.id});
 const first=await json(await owner.open(source)),second=await json(await owner.open(copy));assert.equal(second.panels[0].label,first.panels[0].label);assert.deepEqual(second.layout,first.layout);
 for(let i=0;i<before.length;i++){assert.notEqual(after[i].id,before[i].id);assert.notEqual(after[i].plotId,before[i].plotId);assert.deepEqual(mapped[i],{sourceId:before[i].plotId,targetId:after[i].plotId});const original=(await rows(owner,source,'points',{plotId:before[i].plotId}))[0],point=(await rows(owner,copy,'points',{plotId:after[i].plotId}))[0];assert.notEqual(point.id,original.id);assert.notEqual(point.seriesId,original.seriesId);assert.deepEqual(point.value.source.origin,{ref,seriesId:original.seriesId,pointId:original.id});assert.deepEqual({...point.value,source:undefined},{...original.value,source:undefined});}
 const single=await owner.extract(source,before[0].plotId),singleCopy=await owner.duplicate(single);assert.deepEqual(singleCopy.document,single.document);assert.notEqual(singleCopy.id,single.id);
});


test('replacement imports edit the single plot header through its preserved wrapper identity',async()=>{
 const f=fixture(),owner=new RetainedFigureAuthoring(f.workspace),source=createFigure();source.title='Mapped source';source.series[0].points=[{x:4,y:9,error:null}];const ref={kind:'analysis',id:randomUUID(),revision:'e'.repeat(64)},retained={...await new RetainedFigureDocuments(f.workspace).retain(source),source:ref},target=await owner.start(null),imported=await owner.import(target,retained,{mode:'replace'});
 const point=(await rows(owner,imported,'points'))[0],panel=(await rows(owner,imported,'panels'))[0];assert.equal(imported.id,target.id);assert.notEqual(panel.plotId,target.id);assert.equal((await (await owner.open(imported)).header()).header.id,target.id);
 let edited=await owner.change(imported,{type:'text',collection:'header',id:target.id,field:'title',offset:0,remove:source.title.length,text:'Mapped observations'});await owner.verify(edited);assert.equal(edited.id,target.id);assert.equal(edited.title,'Mapped observations');assert.equal((await rows(owner,edited,'panels'))[0].plotId,panel.plotId);assert.deepEqual((await rows(owner,edited,'points'))[0],point);
 edited=await owner.change(edited,{type:'patch',collection:'header',id:panel.plotId,plotId:panel.plotId,patch:{x:{label:'Edited coordinate'}}});await owner.verify(edited);const saved=await owner.finish(edited);await owner.verify(saved);assert.equal(saved.id,target.id);const reader=await owner.open(saved),header=await reader.header();assert.equal(header.header.id,target.id);assert.equal(header.header.title,'Mapped observations');assert.equal(header.header.x.label,'Edited coordinate');assert.deepEqual((await rows(owner,saved,'points'))[0].value.source.origin,{ref,seriesId:source.series[0].id,pointId:point.id});assert.equal((await (await owner.open(imported)).header()).header.title,source.title);
 await assert.rejects(owner.change(imported,{type:'patch',collection:'header',id:randomUUID(),patch:{legend:false}}),{code:'MATERIAL_INVALID'});
 const alias=await owner.start({...retained,title:'Copied wrapper display'},{id:target.id}),renamed=await owner.change(alias,{type:'text',collection:'header',id:target.id,field:'title',offset:0,remove:22,text:'Alias edited'});await owner.verify(renamed);assert.equal(renamed.title,'Alias edited');await owner.verify(await owner.finish(renamed));
});
