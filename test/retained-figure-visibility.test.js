import test from 'node:test';
import assert from 'node:assert/strict';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {retainedFigureBlockPath} from '../src/retained-figure-blocks.js';
import {createFigure,createSeries} from '../src/web/figure-model.js';
const fixture=()=>{const files=new Map();return {files,workspace:{readMetadata:async name=>files.get(name)??null,writeMetadata:async(name,text)=>files.set(name,text)}};};
const point=(x,y=2)=>({x,y,error:null});
async function prepared(figure,{documents,signal}={}){
 const f=fixture();documents??=new RetainedFigureDocuments(f.workspace,{signal});const builder=documents.builder(figure);
 await builder.addPlot(figure);for(const series of figure.series){await builder.addSeries(series);for(const value of series.points)await builder.addPoint(value);}
 const ids=new Set(figure.series.map(series=>series.id)),lookups=new Map(),find=builder.presentation.index.find.bind(builder.presentation.index);
 builder.presentation.index.find=async(...args)=>{const id=args[1];if(ids.has(id))lookups.set(id,(lookups.get(id)??0)+1);return find(...args);};
 return {...f,documents,builder,lookups};
}
const json=async reader=>{let text='';for await(const chunk of reader.json())text+=chunk;return JSON.parse(text);};

test('finalization reuses verified visibility across point snapshots and preserves exact visible domains',async()=>{
 const figure=createFigure();figure.series[0].points=Array.from({length:65},(_,i)=>point(1+3*i,2+i));
 figure.series.push({...createSeries('Hidden',1),style:{visible:false},points:[point(2,10000),point(194,20000),point(10000,30000)]});
 figure.series.push({...createSeries('Visible',2),points:[point(196,67),point(199,68)]});
 const {documents,builder,lookups}=await prepared(figure),saved=await builder.finish(),reader=await documents.open(saved),header=await reader.header();
 assert.deepEqual([...lookups.values()],[1,1,1]);assert.equal(header.domains.minimumXGap,3);assert.equal(header.domains.minimumLogXGap,Math.log(199)-Math.log(196));
 assert.deepEqual(header.domains.x,{min:1,max:199,positiveMin:1,positiveMax:199});assert.deepEqual(header.domains.y,{min:2,max:68,positiveMin:2,positiveMax:68});
 assert.equal(header.domains.visibleSeriesCount,2);assert.equal(header.counts.points,70);await reader.verify();assert.deepEqual(await json(reader),figure);
});

test('visibility receipts evict old series after the fixed 512-series bound',async()=>{
 const figure=createFigure();figure.kind='scatter';figure.series=Array.from({length:513},(_,i)=>({...createSeries('Series '+i,i),points:[point(i+1)]}));
 figure.series[512].points.push(point(9999));figure.series[0].points.push(point(10000));figure.series[1].points.push(point(10001));
 const {documents,builder,lookups}=await prepared(figure),saved=await builder.finish();
 assert.equal(lookups.get(figure.series[0].id),2);assert.equal(lookups.get(figure.series[1].id),2);assert.equal(lookups.get(figure.series[512].id),1);
 assert.equal([...lookups.values()].reduce((sum,count)=>sum+count,0),515);const reader=await documents.open(saved);assert.equal((await reader.header()).counts.series,513);assert.deepEqual(await json(reader),figure);
});

test('visibility receipts never cross finalization roots when series identities are reused',async()=>{
 const f=fixture(),documents=new RetainedFigureDocuments(f.workspace),figure=createFigure();figure.series[0].points=[point(1),point(4)];
 figure.series.push({...createSeries('Changed',1),style:{visible:false},points:[point(2),point(3)]});
 const first=await prepared(figure,{documents}),saved=await first.builder.finish();assert.deepEqual([...first.lookups.values()],[1,1]);assert.equal((await (await documents.open(saved)).header()).domains.minimumXGap,3);
 const changed=structuredClone(figure);changed.series[1].style.visible=true;const second=await prepared(changed,{documents}),next=await second.builder.finish();
 assert.notEqual(saved.document.presentation.root,next.document.presentation.root);assert.deepEqual([...second.lookups.values()],[1,1]);assert.equal((await (await documents.open(next)).header()).domains.minimumXGap,1);
 assert.deepEqual(await json(await documents.open(saved)),figure);assert.deepEqual(await json(await documents.open(next)),changed);
});

test('cached series visibility still observes cancellation at later point snapshots',async()=>{
 const controller=new AbortController(),figure=createFigure();figure.series[0].points=Array.from({length:65},(_,i)=>point(i+1));
 const {documents,builder,lookups}=await prepared(figure,{signal:controller.signal}),read=documents.blocks.readSnapshot.bind(documents.blocks);let batches=0;
 documents.blocks.readSnapshot=operation=>{if(++batches===2)controller.abort(new DOMException('Cancelled','AbortError'));return read(operation);};
 await assert.rejects(builder.finish(),{name:'AbortError'});assert.equal(batches,2);assert.equal(lookups.get(figure.series[0].id),1);assert.equal(builder.done,false);
});

test('finalization refuses missing and corrupted series presentations before retaining a result',async()=>{
 const figure=createFigure();figure.series[0].points=[point(1),point(2)];
 const missing=await prepared(figure),find=missing.builder.presentation.index.find.bind(missing.builder.presentation.index);
 missing.builder.presentation.index.find=(scope,id)=>id===figure.series[0].id?null:find(scope,id);
 await assert.rejects(missing.builder.finish(),{code:'MATERIAL_MISSING'});assert.equal(missing.builder.done,false);
 const corrupt=await prepared(figure),member=await corrupt.builder.presentation.find('series',figure.series[0].id),presentation=await corrupt.builder.tree.read(member.revision);
 await corrupt.documents.blocks.flush();corrupt.files.set(retainedFigureBlockPath('value',presentation.body),'altered');corrupt.documents.blocks.cache.clear();corrupt.documents.blocks.bytes=0;
 await assert.rejects(corrupt.builder.finish(),{code:'MATERIAL_MISSING'});assert.equal(corrupt.builder.done,false);
});
