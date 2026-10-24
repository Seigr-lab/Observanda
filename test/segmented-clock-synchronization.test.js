import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AppError} from '../src/errors.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {retainScalarDefinitions,readScalarDefinition} from '../src/measurement-scalar-storage.js';
import {blankClock,blankQuantity} from '../src/web/measurement-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {validClockSynchronization,validClockSynchronizationSegment,validClockSynchronizationAnchor,validClockSynchronizationDescriptor,assertSynchronizationColumn} from '../src/web/measurement-clock-synchronization-model.js';
import {prepareClockSynchronization,verifyClockSynchronization,calculateClockSynchronizationNode,clockSynchronizationColumn,selectClockSynchronizationAnchors,validateClockSynchronizationEdit} from '../src/measurement-clock-synchronization.js';
const ref=kind=>({kind,id:randomUUID(),revision:'a'.repeat(64)});
const scalar=(spelling,representation='integer',radix=10)=>({spelling:String(spelling),representation,radix});
const cell=value=>({kind:'string',value:String(value)});
const row=(page,row)=>({page,row});
const locator=(ref,page,row,column)=>({ref,selector:{kind:'cell',page,row,column}});
async function fixture({count=2,anchorCount=3}={}){
 const source=ref('dataset'),reference=ref('dataset'),model=ref('analysis'),policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxOperations:1000000,maxMilliseconds:30000});
 const sourceColumn={name:'Reset elapsed',representation:'integer',radix:10,unit:'device s',quantity:blankQuantity(),missing:[{value:'NA',meaning:'not observed'}],resourcePolicy:policy,time:{kind:'elapsed',reference:'declared device origin',resolution:'',uncertainty:'',clock:{...blankClock(),wrap:'none',reset:'observed'}}};
 const referenceColumn={...structuredClone(sourceColumn),name:'Reference elapsed',unit:'reference s',time:{kind:'inferred-elapsed',reference:'reference origin',resolution:'',uncertainty:'',clock:{...blankClock(),wrap:'none',reset:'none',epoch:'reference epoch'}}};
 const stored=new Map(),workspace={readMetadata:async key=>stored.get(key)??null,writeMetadata:async(key,text)=>stored.set(key,text)},sequences=new MaterialSequence(workspace),sourceRows=new Map(),referenceRows=new Map(),segments=[],pairs=[],reads=[],stats={active:0,max:0,items:0,pages:0};
 const makeSequence=async(kind,items)=>{const b=sequences.builder(kind,fn=>fn());for(const item of items)await b.append(item);return b.finish();};
 for(let s=0;s<count;s++){
  const page=s*2,x=Array.from({length:anchorCount},(_,i)=>anchorCount===3?[0,2,5][i]:i),y=x.map(v=>(s+1)*100+(s===0&&anchorCount===3?(v<=2?2*v:4+3*(v-2)):3*v));
  sourceRows.set(page,Array.from({length:anchorCount*2-1},(_,i)=>({cells:[String(i%2===0?x[i/2]:1)],valueKinds:['string'],excluded:null})));
  referenceRows.set(page,Array.from({length:anchorCount*2-1},(_,i)=>({cells:[String(i%2===0?y[i/2]:1)],valueKinds:['string'],excluded:null})));
  const anchors=x.map((_,i)=>({source:locator(source,page,i*2,3),reference:locator(reference,page,i*2,7)}));pairs.push(anchors);
  segments.push({version:1,kind:'clock-sync-segment',id:randomUUID(),name:'Segment '+s,range:{first:row(page,0),last:row(page,anchorCount*2-2)},validity:{lower:scalar(x[0]),upper:scalar(x.at(-1))},anchorsIndex:await makeSequence('clock-sync-anchors',anchors),rationale:'Explicit uninterrupted reset epoch '+s,resourcePolicy:structuredClone(policy)});
 }
 const definition={version:2,method:'segmented-piecewise-affine-v1',source:{ref:source,column:3},reference:{ref:reference,column:7},segmentsIndex:await makeSequence('clock-sync-segments',segments),target:{unit:referenceColumn.unit,quantity:structuredClone(referenceColumn.quantity),time:structuredClone(referenceColumn.time)},rationale:'Declared piecewise interpolation with explicit reset epochs.',resourcePolicy:policy};
 let content={tool:'Observanda clock synchronization',...definition};
 const materials={workspace,sequences,read:async selected=>{reads.push(selected);return selected.id===model.id?{kind:'analysis',content}:{kind:'dataset',id:selected.id};},datasetColumn:async doc=>doc.id===source.id?sourceColumn:referenceColumn,retainedDatasetPage:async(doc,page,options)=>{stats.pages++;stats.max=Math.max(stats.max,++stats.active);try{assert.ok(options.metadataOnly||options.columns.length===1);return {rows:structuredClone((doc.id===source.id?sourceRows:referenceRows).get(page)??[])};}finally{stats.active--;}}};
 const originalItem=sequences.item.bind(sequences);sequences.item=async(...args)=>{stats.items++;return originalItem(...args);};
 const node={id:randomUUID(),kind:'clock-synchronize',model,operation:'value',outside:'absent',column:3};
 const refresh=async()=>{definition.segmentsIndex=await makeSequence('clock-sync-segments',segments);content={tool:'Observanda clock synchronization',...definition};};
 const run=async(value,location,options={})=>calculateClockSynchronizationNode(materials,node,cell(value),sourceColumn,{location,...options});
 return {source,reference,model,policy,sourceColumn,referenceColumn,definition,get content(){return content;},set content(value){content=value;},segments,pairs,sourceRows,referenceRows,materials,sequences,makeSequence,refresh,node,run,reads,stats,stored};
}

test('v2 pins paged declarations and admits observed reset only for its source',async()=>{
 const f=await fixture();assert.equal(validClockSynchronization(f.definition),true);assert.equal(validClockSynchronizationSegment(f.segments[0],{complete:true}),true);assert.equal(validClockSynchronizationAnchor(f.pairs[0][0],f.definition),true);
 assert.throws(()=>assertSynchronizationColumn(f.sourceColumn));assert.doesNotThrow(()=>assertSynchronizationColumn(f.sourceColumn,{segmented:true}));
 for(const [wrap,reset] of [['unknown','observed'],['modulo','observed'],['none','unknown']])assert.throws(()=>assertSynchronizationColumn({...f.sourceColumn,time:{...f.sourceColumn.time,clock:{...f.sourceColumn.time.clock,wrap,reset}}},{segmented:true}));
 const invalid=structuredClone(f.definition);invalid.target.time.clock.reset='observed';assert.equal(validClockSynchronization(invalid),false);
 const foreign=structuredClone(f.pairs[0][0]);foreign.source.ref.workspaceId=randomUUID();assert.equal(validClockSynchronizationAnchor(foreign,f.definition),false);
 const output=clockSynchronizationColumn(f.node,f.sourceColumn,f.content);assert.equal(validClockSynchronizationDescriptor(output.synchronization),true);assert.equal(output.synchronization.segmentCount,2);assert.equal(Object.hasOwn(output.synchronization,'validity'),false);assert.deepEqual(output.time.clock.model,f.model);
 for(const key of ['id','revision'])assert.equal(JSON.stringify(output.synchronization).includes(f.source[key]),false);
});

test('piecewise interpolation is exact and repeated x selects the declared original row segment',async()=>{
 const f=await fixture(),prepared=await prepareClockSynchronization(f.materials,f.definition);assert.deepEqual(prepared,f.content);const verified=await verifyClockSynchronization(f.materials,prepared);
 for(const [x,page,r,expected] of [[0,0,0,'100/1'],[1,0,1,'102/1'],[2,0,2,'104/1'],[3,0,3,'107/1'],[5,0,4,'113/1'],[1,2,1,'203/1']])assert.equal((await f.run(x,{kind:'dataset',page,row:r},{verified})).value,expected);
 const selected=await selectClockSynchronizationAnchors(f.materials,verified,cell(3),f.sourceColumn,{location:{page:0,row:3}});assert.deepEqual(selected.segment,{id:f.segments[0].id,position:0});assert.deepEqual(selected.bracket.map(x=>x.position),[1,2]);assert.equal(selected.status,'ready');assert.equal(JSON.stringify(verified).includes('anchors"'),false);
});

test('closed validity and gaps never interpolate across resets, and missing/excluded statuses stay distinct',async()=>{
 const f=await fixture();f.segments[0].validity={lower:scalar(1),upper:scalar(4)};await f.refresh();const verified=await verifyClockSynchronization(f.materials,f.content);
 for(const [x,location] of [[0,{page:0,row:0}],[5,{page:0,row:4}],[1,{page:1,row:0}],[1,{page:5,row:0}]])assert.equal((await f.run(x,location,{verified})).kind,'absent');
 await assert.rejects(calculateClockSynchronizationNode(f.materials,{...f.node,outside:'error'},cell(0),f.sourceColumn,{verified,location:{page:0,row:0}}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE'});
 for(const [input,location,status] of [[cell('NA'),{page:0,row:1},'missing-input'],[{kind:'null',value:''},{page:0,row:1},'missing-input'],[cell(1),null,'missing-input'],[cell(1),{page:0,row:1,excluded:'declared'},'excluded-input']])assert.equal((await selectClockSynchronizationAnchors(f.materials,verified,input,f.sourceColumn,{location})).status,status);
});

test('complete execution rejects ordering, overlap, duplicate anchors and unsupported source declarations',async()=>{
 for(const change of [f=>f.segments.reverse(),f=>f.segments[1].range.first=row(0,4),f=>f.segments[0].validity.upper=scalar(6),f=>f.sourceRows.get(0)[2].cells[0]='0',f=>f.referenceRows.get(0)[2].cells[0]='99',f=>f.referenceRows.get(0)[2].excluded='not evidence',f=>f.sourceColumn.time.kind='counter']){
  const f=await fixture();change(f);await f.refresh();await assert.rejects(verifyClockSynchronization(f.materials,f.content));
 }
 const f=await fixture();f.segments[0].anchorsIndex=await f.makeSequence('clock-sync-anchors',[f.pairs[0][0]]);await f.refresh();await assert.rejects(verifyClockSynchronization(f.materials,f.content),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});
});

test('editable drafts retain partial/reordered declarations while execution still refuses them',async()=>{
 const f=await fixture();f.segments.reverse();f.segments[0].anchorsIndex=await f.makeSequence('clock-sync-anchors',[]);await f.refresh();assert.ok(await verifyClockSynchronization(f.materials,f.content,{complete:false}));await assert.rejects(verifyClockSynchronization(f.materials,f.content));
 f.segments.length=0;await f.refresh();const draft=await prepareClockSynchronization(f.materials,f.definition,{complete:false});assert.equal(draft.segmentsIndex.count,0);await assert.rejects(verifyClockSynchronization(f.materials,draft));
 const bad=await fixture();bad.segments[0].validity.lower=scalar(8);await bad.refresh();await assert.rejects(verifyClockSynchronization(bad.materials,bad.content,{complete:false}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE'});
});

test('late segment and bracket lookups remain bounded rather than rereading all retained anchors',async()=>{
 const f=await fixture({count:17,anchorCount:33}),verified=await verifyClockSynchronization(f.materials,f.content);f.stats.items=0;f.stats.pages=0;
 assert.equal((await f.run(30,{page:32,row:61},{verified})).value,'1790/1');assert.ok(f.stats.items<=20,f.stats.items);assert.ok(f.stats.pages<=18,f.stats.pages);assert.equal(f.stats.max,1);
 const first=await fixture();const own=await verifyClockSynchronization(first.materials,first.content);assert.equal((await first.run(1,{page:0,row:1},{verified:own})).value,'102/1');
});

test('retained bounds and long mixed-radix anchors preserve full spelling under owned scalar policies',async()=>{
 const f=await fixture({count:1});Object.assign(f.policy.resources,{maxScalarCharacters:12000,maxExponent:12000});f.segments[0].resourcePolicy=structuredClone(f.policy);f.sourceColumn.representation='radix';f.sourceColumn.radix=6;
 const long='0'.repeat(9000)+'0';f.segments[0].validity.lower=scalar(long,'radix',6);f.segments[0]=await retainScalarDefinitions(f.materials,f.segments[0],fn=>fn());assert.equal(f.segments[0].validity.lower.spelling.format,'dataset-cell');assert.equal((await readScalarDefinition(f.materials,f.segments[0],'validity.lower.spelling',{offset:8999,limit:2})).text,'00');
 const retained=await retainDatasetCell(f.materials,cell(long),fn=>fn());f.sourceRows.get(0)[0].cells[0]=retained.value;await f.refresh();const verified=await verifyClockSynchronization(f.materials,f.content);assert.equal((await f.run('3',{page:0,row:3},{verified})).value,'107/1');
 for(const text of f.stored.values())assert.ok(Buffer.byteLength(text)<1048576);
});

test('source/segment/consumer policy limits and cumulative validation refuse rather than reset budgets',async()=>{
 const f=await fixture(),tight=structuredClone(f.policy);tight.resources.maxOperations=10;await assert.rejects(verifyClockSynchronization(f.materials,f.content,{policy:tight}),{code:'DATASET_CALCULATION_RESOURCE'});
 const v=await verifyClockSynchronization(f.materials,f.content),budget=new DatasetResourceBudget(tight);await assert.rejects(f.run(1,{page:0,row:1},{verified:v,budget}),{code:'DATASET_CALCULATION_RESOURCE'});
 f.sourceColumn.resourcePolicy=structuredClone(f.policy);f.sourceColumn.resourcePolicy.resources.maxScalarCharacters=16;f.sourceRows.get(0)[0].cells[0]='0'.repeat(17);await assert.rejects(verifyClockSynchronization(f.materials,f.content),{code:'DATASET_CALCULATION_RESOURCE'});
 const segment=await fixture();segment.segments[0].resourcePolicy.resources.maxScalarCharacters=16;segment.segments[0].validity.lower=scalar('0'.repeat(17));await segment.refresh();await assert.rejects(verifyClockSynchronization(segment.materials,segment.content));
});

test('cancellation, pinned access and changed cached declarations are rechecked',async()=>{
 const f=await fixture(),verified=await verifyClockSynchronization(f.materials,f.content),controller=new AbortController();controller.abort();await assert.rejects(f.run(1,{page:0,row:1},{verified,signal:controller.signal}),{name:'AbortError'});
 const denied=new AppError('MATERIAL_MISSING');f.materials.read=async()=>{throw denied;};await assert.rejects(f.run(1,{page:0,row:1},{verified}),error=>error===denied);
 const changed=await fixture(),old=await verifyClockSynchronization(changed.materials,changed.content);changed.content.rationale='Changed revision content';await assert.rejects(changed.run(1,{page:0,row:1},{verified:old}));
 const during=await fixture(),cancel=new AbortController(),item=during.sequences.item.bind(during.sequences);let reads=0;during.sequences.item=async(...args)=>{const value=await item(...args);if(++reads===2)cancel.abort();return value;};await assert.rejects(verifyClockSynchronization(during.materials,during.content,{signal:cancel.signal}),{name:'AbortError'});assert.equal(reads,2);
});


test('single-entry authoring validates bounded selected data without scanning or sorting other entries',async()=>{
 const f=await fixture({count:17,anchorCount:5});f.stats.items=0;f.stats.pages=0;
 await prepareClockSynchronization(f.materials,f.definition,{complete:false,headerOnly:true});assert.equal(f.stats.items,0);assert.equal(f.stats.pages,0);
 await validateClockSynchronizationEdit(f.materials,f.content,{segment:f.segments[16],anchor:f.pairs[16][2]});assert.equal(f.stats.items,0);assert.equal(f.stats.pages,4);
 await assert.rejects(prepareClockSynchronization(f.materials,f.definition,{headerOnly:true}));
 const invalid=structuredClone(f.pairs[16][2]);invalid.source.selector.page=0;await assert.rejects(validateClockSynchronizationEdit(f.materials,f.content,{segment:f.segments[16],anchor:invalid}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR'});
 const wrong=structuredClone(f.segments[16]);wrong.validity.lower=scalar(10);await assert.rejects(validateClockSynchronizationEdit(f.materials,f.content,{segment:wrong}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE'});
});


test('standalone lineage selection rechecks pinned source declarations even with header-only context',async()=>{
 const f=await fixture(),context=await verifyClockSynchronization(f.materials,f.content,{sources:false});f.reads.length=0;
 const selected=await selectClockSynchronizationAnchors(f.materials,context,cell(1),f.sourceColumn,{location:{page:0,row:1}});assert.equal(selected.status,'ready');assert.deepEqual(f.reads.slice(0,2),[f.source,f.reference]);
 const original=f.materials.read,denied=new AppError('MATERIAL_MISSING');f.materials.read=async ref=>{if(ref.id===f.reference.id)throw denied;return original(ref);};
 await assert.rejects(selectClockSynchronizationAnchors(f.materials,context,cell(1),f.sourceColumn,{location:{page:1,row:0}}),error=>error===denied);
});
