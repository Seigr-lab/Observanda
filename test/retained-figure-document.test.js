import {changeRetainedFigure} from '../src/retained-figure-presentation.js';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {createFigure,createSeries} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {defaultHeatmap} from '../src/web/figure-heatmap.js';
import {validRetainedFigure,validRetainedFigureDocument,validRetainedFigureWindow} from '../src/web/retained-figure-model.js';
const fixture=()=>{const files=new Map();let reads=0,writes=0;return {files,get reads(){return reads;},get writes(){return writes;},reset(){reads=0;},workspace:{async readMetadata(name){reads++;return files.get(name)??null;},async writeMetadata(name,text){writes++;files.set(name,text);}}};};
const json=async reader=>{let result='';for await(const part of reader.json())result+=part;return JSON.parse(result);};
test('retained figure roots separate complete point data from bounded presentation and exact lookup',async()=>{
 const f=fixture(),figure=createFigure();figure.series[0].points=Array.from({length:10241},(_,i)=>({x:i,y:i%31,error:i%3}));
 figure.x.ticks=[{value:0,label:'Origin'},{value:20000,label:'Explicit outer tick'}];figure.annotations=[];
 const documents=new RetainedFigureDocuments(f.workspace),saved=await documents.retain(figure);assert.ok(validRetainedFigure(saved));assert.equal(saved.document.counts.points,10241);assert.ok(!Object.hasOwn(saved,'series'));
 const reopened=await new RetainedFigureDocuments(f.workspace,{readOnly:true}).open(saved);f.reset();const tail=await reopened.window({collection:'points',seriesId:figure.series[0].id,offset:10240,limit:1});assert.equal(tail.items[0].position,10240);assert.deepEqual(tail.items[0].value,figure.series[0].points[10240]);assert.equal(tail.next,null);assert.ok(f.reads<80,'selected tail only follows bounded paths');
 assert.deepEqual(await reopened.item({collection:'points',id:tail.items[0].id}),tail.items[0]);const header=await reopened.header();assert.equal(header.domains.x.max,20000);assert.equal(header.domains.minimumXGap,1);assert.equal(header.domains.visibleSeriesCount,1);assert.deepEqual(await json(reopened),figure);
 let blocks=0;for await(const block of reopened.blocks()){assert.equal(typeof block.path,'string');blocks++;}assert.ok(blocks>0);assert.equal(validRetainedFigureWindow({collection:'points',limit:129}),false);assert.equal(validRetainedFigureDocument({...saved.document,counts:{...saved.document.counts,points:-1}}),false);
});
test('retained figure pages many stable series, full Unicode text and visible heatmap category lookup',async()=>{
 const f=fixture(),figure=createFigure();figure.kind='bar';figure.x.kind='category';figure.title='Long '+('λ😀'.repeat(90000));figure.series=Array.from({length:257},(_,i)=>({...createSeries('Series '+i,i),points:[{x:'A',y:i,error:null},{x:'A',y:i+1,error:null},{x:'B',y:null,error:null}],...(i===0?{style:{visible:false}}:{})}));
 figure.series[1].name='Name '+('δ😀'.repeat(90000));
 const saved=await new RetainedFigureDocuments(f.workspace).retain(figure);assert.ok(validRetainedFigure(saved));assert.equal(saved.title.format,'figure-text');const reader=await new RetainedFigureDocuments(f.workspace,{readOnly:true}).open(saved),header=await reader.header();assert.equal(header.counts.series,257);assert.equal(header.domains.visibleSeriesCount,256);assert.equal(header.domains.categoryCount,2);assert.equal(header.header.title.characters,figure.title.length);
 const page=await reader.window({collection:'series',offset:256,limit:1});assert.equal(page.items[0].id,figure.series[256].id);const first=await reader.item({collection:'series',id:figure.series[1].id});assert.equal(first.value.name.characters,figure.series[1].name.length);
 const text=await reader.text({collection:'series',id:first.id,field:'name',offset:260000,limit:100});assert.equal(text.text,figure.series[1].name.slice(260000,260100));assert.equal(text.next,260100);let whole='';for await(const chunk of reader.textChunks({collection:'header',id:figure.id,field:'title'}))whole+=chunk;assert.equal(whole,figure.title);
 assert.equal(await reader.categoryPosition({plotId:figure.id,value:'B'}),1);assert.equal((await reader.pointAtCategory({plotId:figure.id,seriesId:figure.series[1].id,value:'A'})).value.y,2);assert.deepEqual(await json(reader),figure);
});
test('retained figure admission rejects altered blocks and inconsistent roots without overwriting',async()=>{
 const f=fixture(),figure=createFigure();figure.series[0].points=[{x:1,y:2,error:null}];const saved=await new RetainedFigureDocuments(f.workspace).retain(figure),reader=await new RetainedFigureDocuments(f.workspace).open(saved);let first;for await(const block of reader.blocks()){first=block;break;}const original=f.files.get(first.path);f.files.set(first.path,original.replace(/./,'!'));await assert.rejects(async()=>{const fresh=await new RetainedFigureDocuments(f.workspace).open(saved);for await(const block of fresh.blocks())void block;},{code:'MATERIAL_MISSING'});f.files.set(first.path,original);
 const altered=structuredClone(saved);altered.document.counts.points=2;await assert.rejects(new RetainedFigureDocuments(f.workspace).open(altered),{code:'MATERIAL_MISSING'});
 const wrong=structuredClone(saved);wrong.document.presentation.root=wrong.document.data.root;await assert.rejects(new RetainedFigureDocuments(f.workspace).open(wrong),{code:'MATERIAL_MISSING'});
});

test('retained figure reverse audit authenticates selected indexes and derived visible domains',async()=>{
 const f=fixture(),figure=createFigure();figure.series[0].points=[{x:1,y:2,error:null},{x:3,y:4,error:1}];figure.series.push({...createSeries('Hidden',1),style:{visible:false},points:[{x:200,y:300,error:null}]});figure.x.ticks=[{value:10,label:'Outer'}];
 const documents=new RetainedFigureDocuments(f.workspace),saved=await documents.retain(figure),reader=await documents.open(saved);assert.deepEqual(await reader.verify(),saved.document.counts);
 const panel=await reader.panelMember(figure.id),body=await reader.tree.read(panel.body);assert.equal(body.domains.x.max,10);assert.equal((await reader.window({collection:'series'})).items[0].visiblePosition,0);
 const original=reader.presentationIndex.collections.series.keys;reader.presentationIndex.collections.series.keys=null;await assert.rejects(reader.verify(),{code:'MATERIAL_MISSING'});reader.presentationIndex.collections.series.keys=original;
 const copy=structuredClone(saved);copy.id=randomUUID();copy.source={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)};assert.deepEqual((await documents.open(copy)).figure.source,copy.source);
});


test('selected presentation edits keep data identities and splice complete long text without preview replacement',async()=>{
 const f=fixture(),figure=createFigure();figure.title='Heading '+('???'.repeat(7000));figure.x.kind='category';figure.kind='bar';figure.series[0].points=[{x:'A',y:2,error:null},{x:'B',y:3,error:null}];figure.series.push({...createSeries('Second',1),points:[{x:'B',y:4,error:null},{x:'C',y:5,error:null}]});
 const documents=new RetainedFigureDocuments(f.workspace),saved=await documents.retain(figure),data=saved.document.data;
 const title=await changeRetainedFigure(documents,saved,{type:'text',collection:'header',field:'title',offset:7000,remove:5,text:'New ??'});assert.deepEqual(title.document.data,data);assert.equal(title.title.characters,figure.title.length+1);
 const first=await documents.open(title),all=await json(first);assert.equal(all.title,figure.title.slice(0,7000)+'New ??'+figure.title.slice(7005));assert.equal((await json(await documents.open(saved))).title,figure.title);
 await assert.rejects(changeRetainedFigure(documents,title,{type:'patch',collection:'header',patch:{title:'preview'}}),{code:'MATERIAL_INVALID'});
 let edited=await changeRetainedFigure(documents,title,{type:'patch',collection:'series',id:figure.series[0].id,patch:{style:{visible:false},color:'#112233',name:'First renamed'}});assert.deepEqual(edited.document.data,data);let reader=await documents.open(edited);assert.equal((await reader.header()).domains.visibleSeriesCount,1);assert.equal((await reader.header()).domains.categoryCount,2);assert.deepEqual((await reader.window({collection:'categories'})).items.map(row=>row.value),['B','C']);await reader.verify();
 edited=await changeRetainedFigure(documents,edited,{type:'move',collection:'series',id:figure.series[1].id,direction:-1});reader=await documents.open(edited);assert.equal((await reader.window({collection:'series'})).items[0].id,figure.series[1].id);assert.deepEqual(edited.document.data,data);await reader.verify();
 const annotation={id:randomUUID(),kind:'callout',label:'Note '+('?'.repeat(2000)),color:'#92549f',opacity:.2,seriesId:figure.series[1].id,pointIndex:1,dx:24,dy:-36};
 edited=await changeRetainedFigure(documents,edited,{type:'append',collection:'annotations',plotId:figure.id,value:annotation});reader=await documents.open(edited);assert.equal((await reader.item({collection:'annotations',id:annotation.id})).value.label.characters,annotation.label.length);await reader.verify();
 edited=await changeRetainedFigure(documents,edited,{type:'remove',collection:'annotations',id:annotation.id});reader=await documents.open(edited);assert.equal((await reader.window({collection:'annotations'})).total,0);await reader.verify();
 const cells=await reader.cells({plotId:figure.id,seriesId:figure.series[1].id,limit:1});assert.equal(cells.total,2);assert.equal(cells.items[0].category.value,'B');assert.equal(cells.items[0].point.value.y,4);
 await assert.rejects(changeRetainedFigure(documents,edited,{type:'patch',collection:'header',patch:{projection:{version:1}}}),{code:'MATERIAL_INVALID'});
});


test('presentation admission checks actual hidden intervals, counts, ticks and logarithmic annotations',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),base=()=>{const figure=createFigure();figure.kind='scatter';figure.series[0].points=[{x:2,y:4,error:null}];return figure;};
 const interval=base();interval.series.push({...createSeries('Hidden interval',1),style:{visible:false},points:[{x:2,y:4,error:null,xLower:-1,xUpper:3}]});const intervals=await documents.retain(interval);
 await assert.rejects(changeRetainedFigure(documents,intervals,{type:'patch',collection:'header',patch:{x:{scale:'log'}}}),{code:'MATERIAL_INVALID'});
 const counted=base();counted.markerArea={unitArea:1,label:'Population'};counted.series[0].points[0].count=1000;const counts=await documents.retain(counted);
 await assert.rejects(changeRetainedFigure(documents,counts,{type:'patch',collection:'header',patch:{markerArea:{unitArea:100}}}),{code:'MATERIAL_INVALID'});
 const missing=await documents.retain(base());await assert.rejects(changeRetainedFigure(documents,missing,{type:'patch',collection:'header',patch:{markerArea:{unitArea:1,label:'Population'}}}),{code:'MATERIAL_INVALID'});
 const ticked=base();ticked.x.ticks=[{value:10,label:'Outside proposed range'}];const ticks=await documents.retain(ticked);await assert.rejects(changeRetainedFigure(documents,ticks,{type:'patch',collection:'header',patch:{x:{max:8}}}),{code:'MATERIAL_INVALID'});
 const annotated=base();annotated.annotations=[{id:randomUUID(),kind:'boundary',axis:'x',start:-1,end:null,label:'Negative boundary',color:'#123456',opacity:.2}];const annotations=await documents.retain(annotated);await assert.rejects(changeRetainedFigure(documents,annotations,{type:'patch',collection:'header',patch:{x:{scale:'log'}}}),{code:'MATERIAL_INVALID'});
 const valid=await changeRetainedFigure(documents,counts,{type:'patch',collection:'header',patch:{x:{scale:'log'},y:{scale:'log'},markerArea:{unitArea:2}}});assert.deepEqual(valid.document.data,counts.document.data);await (await documents.open(valid)).verify();
 assert.deepEqual(await json(await documents.open(counts)),counted);
});

test('linked presentation checks every panel and full text while complete exports preserve wrapper identity',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),label='Axis '+('\u03bb\ud83d\ude00'.repeat(600)),tickLabel='Tick '+('\u03b4'.repeat(1800));
 const plots=Array.from({length:9},()=>{const plot=createFigure();plot.x.label=label;plot.y.label='Value';plot.series[0].points=[{x:1,y:2,error:null}];plot.x.ticks=[{value:0,label:tickLabel},{value:2,label:'End'}];return plot;});plots[8].x.ticks.reverse();
 const composed=createComposition(plots),saved=await documents.retain(composed),linked=await changeRetainedFigure(documents,saved,{type:'patch',collection:'header',patch:{layout:{linkX:true,linkY:true}}});await (await documents.open(linked)).verify();
 const last=composed.panels[8].figure,reader=await documents.open(linked),tick=(await reader.window({collection:'ticks',plotId:last.id})).items.find(row=>row.value.value===0);
 await assert.rejects(changeRetainedFigure(documents,linked,{type:'text',collection:'header',plotId:last.id,field:'x.label',offset:label.length-1,remove:1,text:'Z'}),{code:'MATERIAL_INVALID'});
 await assert.rejects(changeRetainedFigure(documents,linked,{type:'text',collection:'ticks',id:tick.id,field:'label',offset:tickLabel.length-1,remove:1,text:'Z'}),{code:'MATERIAL_INVALID'});
 const source={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},wrapped={...linked,id:randomUUID(),title:'Selected composition',source},exported=await json(await documents.open(wrapped));assert.equal(exported.id,wrapped.id);assert.equal(exported.title,wrapped.title);assert.deepEqual(exported.source,source);assert.deepEqual(exported.panels.map(p=>p.figure.id),composed.panels.map(p=>p.figure.id));
 const one=await documents.retain(plots[0]),selected={...one,id:randomUUID(),title:'Selected plot',source},complete=await json(await documents.open(selected));assert.equal(complete.id,selected.id);assert.equal(complete.title,selected.title);assert.deepEqual(complete.source,source);assert.deepEqual(complete.series,plots[0].series);
 const different=structuredClone(composed);different.panels[8].figure.x.label+='Z';const unlinked=await documents.retain(different);await assert.rejects(changeRetainedFigure(documents,unlinked,{type:'patch',collection:'header',patch:{layout:{linkX:true}}}),{code:'MATERIAL_INVALID'});
});

test('selected heatmap threshold operations preserve complete labels and reject aggregate preview replacement',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),figure=createFigure();figure.kind='heatmap';figure.x.kind='category';figure.series[0].points=[{x:'A',y:2,error:null}];figure.heatmap=defaultHeatmap();figure.heatmap.valueLabel='Values '+('\u03bb'.repeat(18000));figure.heatmap.thresholds[0].label='Low '+('\ud83d\ude00'.repeat(9000));figure.heatmap.thresholds[1].label='Middle '+('\u03b4'.repeat(18000));
 const saved=await documents.retain(figure),painted=await changeRetainedFigure(documents,saved,{type:'threshold',collection:'header',index:0,patch:{color:'#123456',max:.5}}),paintedValue=await json(await documents.open(painted));assert.equal(paintedValue.heatmap.thresholds[0].color,'#123456');assert.equal(paintedValue.heatmap.thresholds[0].max,.5);assert.equal(paintedValue.heatmap.thresholds[0].label,figure.heatmap.thresholds[0].label);assert.equal(paintedValue.heatmap.thresholds[1].label,figure.heatmap.thresholds[1].label);assert.deepEqual(painted.document.data,saved.document.data);
 const edited=await changeRetainedFigure(documents,painted,{type:'text',collection:'header',field:'heatmap.thresholds.1.label',offset:18000,remove:1,text:'Z'}),whole=await json(await documents.open(edited));assert.equal(whole.heatmap.thresholds[1].label,figure.heatmap.thresholds[1].label.slice(0,18000)+'Z'+figure.heatmap.thresholds[1].label.slice(18001));await (await documents.open(edited)).verify();
 await assert.rejects(changeRetainedFigure(documents,edited,{type:'patch',collection:'header',patch:{heatmap:{thresholds:(await (await documents.open(edited)).header()).header.heatmap.thresholds}}}),{code:'MATERIAL_INVALID'});
 await assert.rejects(changeRetainedFigure(documents,edited,{type:'threshold',collection:'header',index:0,patch:{max:2}}),{code:'MATERIAL_INVALID'});
 await assert.rejects(changeRetainedFigure(documents,edited,{type:'threshold',collection:'header',index:3,patch:{color:'#123456'}}),{code:'MATERIAL_INVALID'});
 const empty=await changeRetainedFigure(documents,edited,{type:'text',collection:'header',field:'heatmap.valueLabel',offset:0,remove:figure.heatmap.valueLabel.length,text:''});assert.equal((await json(await documents.open(empty))).heatmap.valueLabel,'');
});


test('edited string nodes expose short titles inline across reopen and the long-text boundary',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),figure=createFigure();figure.title='Acquired observations';figure.series[0].points=[{x:1,y:2,error:null}];const original=await documents.retain(figure);
 let current=original,previous=figure.title;
 for(const title of ['Documented observations','\u03bb'.repeat(1025),'Short again','\ud83d\ude00'.repeat(512),'\ud83d\ude00'.repeat(512)+'X']){
  current=await changeRetainedFigure(documents,current,{type:'text',collection:'header',field:'title',offset:0,remove:previous.length,text:title});assert.ok(validRetainedFigure(current));assert.deepEqual(current.document.data,original.document.data);
  const reopened=await new RetainedFigureDocuments(f.workspace,{readOnly:true}).open(current);for(const header of [await reopened.header(),await reopened.header({plotId:figure.id})]){if(title.length<=1024)assert.equal(header.header.title,title);else{assert.equal(header.header.title.format,'figure-text');assert.equal(header.header.title.characters,title.length);}}
  if(title.length<=1024)assert.equal(current.title,title);else assert.equal(current.title.characters,title.length);
  assert.equal((await json(reopened)).title,title);assert.equal((await reopened.text({collection:'header',id:figure.id,field:'title',limit:16384})).text,title);await reopened.verify();previous=title;
 }
 assert.equal((await json(await documents.open(original))).title,figure.title);
 assert.equal(validRetainedFigure({...current,title:{format:'figure-text',version:1,preview:'Short',characters:5}}),false);
});

test('coordinate summaries use bounded read-only snapshots and stop between batches without changing retained identities',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),figure=createFigure();figure.series[0].points=Array.from({length:65},(_,i)=>({x:i*2+2,y:i+1,error:null}));figure.series.push({...createSeries('Hidden',1),style:{visible:false},points:[{x:3,y:500,error:null},{x:5,y:600,error:null}]});
 const builder=documents.builder(figure),snapshot=documents.blocks.readSnapshot.bind(documents.blocks),entryAt=builder.data.index.entryAt.bind(builder.data.index),write=f.workspace.writeMetadata.bind(f.workspace),batches=[];let active=false,entries=0;
 documents.blocks.readSnapshot=async operation=>{assert.equal(active,false);active=true;entries=0;try{return await snapshot(operation);}finally{batches.push(entries);active=false;}};
 builder.data.index.entryAt=async(...args)=>{if(active)entries++;return entryAt(...args);};
 f.workspace.writeMetadata=async(...args)=>{assert.equal(active,false,'summary snapshot never invokes the persistent writer');return write(...args);};
 await builder.addPlot(figure);for(const series of figure.series){await builder.addSeries(series);for(const point of series.points)await builder.addPoint(point);}const saved=await builder.finish();assert.deepEqual(batches,[32,32,3]);
 const reader=await documents.open(saved);assert.equal((await reader.header()).domains.minimumXGap,2);assert.equal((await reader.header()).domains.visibleSeriesCount,1);await reader.verify();assert.deepEqual(await json(reader),figure);
 const controller=new AbortController(),cancelled=new RetainedFigureDocuments(f.workspace,{signal:controller.signal}),partial=cancelled.builder(figure);await partial.addPlot(figure);await partial.addSeries(figure.series[0]);for(const point of figure.series[0].points)await partial.addPoint(point);
 const read=cancelled.blocks.readSnapshot.bind(cancelled.blocks);let begun=0;cancelled.blocks.readSnapshot=operation=>{if(++begun===2)controller.abort(new DOMException('Cancelled','AbortError'));return read(operation);};
 await assert.rejects(partial.finish(),{name:'AbortError'});assert.equal(begun,2);assert.deepEqual(await json(await documents.open(saved)),figure);
});


import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
test('retained header policy verification preserves elapsed resource refusal and can resume without rewriting evidence',async t=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),figure=createFigure(),policy=defaultDatasetResourcePolicy();policy.resources.maxMilliseconds=100;
 const quantity=spelling=>({spelling,representation:'decimal',radix:10});figure.projection={version:2,resourcePolicy:policy,y:{origin:quantity('1000'),scale:quantity('0.1')}};figure.series[0].points=[{x:1,y:2,error:null}];const saved=await documents.retain(figure),reader=await documents.open(saved);await reader.verify();const writes=f.writes;
 let now=0;t.mock.method(Date,'now',()=>now+=1000);await assert.rejects(reader.verify(),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(f.writes,writes);t.mock.restoreAll();await reader.verify();assert.deepEqual((await json(reader)).projection,figure.projection);
});


import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
test('long projection spellings survive selected presentation and manual conversion without replacing exact metadata',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),figure=createFigure(),policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxExponent:12000,maxOperations:200000});const quantity=spelling=>({spelling,representation:'decimal',radix:10});
 figure.title='Long policy formula';figure.projection={version:2,resourcePolicy:policy,y:{origin:quantity('1'+'0'.repeat(9000)),scale:quantity('1.'+'0'.repeat(2200))}};figure.series[0].points=[{x:1,y:2,error:null}];const saved=await documents.retain(figure),changed=await changeRetainedFigure(documents,saved,{type:'text',collection:'header',field:'title',offset:0,remove:figure.title.length,text:'Retitled exact projection'});
 assert.deepEqual(changed.document.data,saved.document.data);const renamed=await documents.open(changed);assert.deepEqual((await json(renamed)).projection,figure.projection);await renamed.verify();
 const authoring=new RetainedFigureAuthoring(f.workspace),draft=await authoring.start(changed),finished=await authoring.finish(draft),complete=await documents.open(finished);await complete.verify();assert.deepEqual((await json(complete)).projection,figure.projection);assert.equal((await json(complete)).title,'Retitled exact projection');
 const extracted=await authoring.extract(finished,finished.id);assert.deepEqual((await json(await documents.open(extracted))).projection,figure.projection);
});
