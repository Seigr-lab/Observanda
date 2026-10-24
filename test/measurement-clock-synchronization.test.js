import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankClock,blankQuantity} from '../src/web/measurement-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {validClockSynchronization,validClockSynchronizationDescriptor,validateClockSynchronizationDescriptor,assertSynchronizationColumn,CLOCK_SYNCHRONIZATION_STATUS_NAMESPACE} from '../src/web/measurement-clock-synchronization-model.js';
import {prepareClockSynchronization,verifyClockSynchronization,evaluateClockSynchronization,calculateClockSynchronizationNode,clockSynchronizationColumn} from '../src/measurement-clock-synchronization.js';
const ref=(kind,n)=>({kind,id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),revision:String(n).repeat(64)});
const source=ref('dataset',1),reference=ref('dataset',2),model=ref('analysis',3);
const scalar=(spelling,representation='integer',radix=10)=>({spelling,representation,radix});
const value=spelling=>({kind:'string',value:spelling});
const cell=(ref,row,column)=>({ref,selector:{kind:'cell',page:0,row,column}});
const node={kind:'clock-synchronize',model,operation:'value',outside:'absent',column:3};
function fixture(){
 const sourceColumn={name:'Device interval',representation:'radix',radix:6,unit:'device interval',quantity:blankQuantity(),missing:[{value:'NA',meaning:'Not observed'}],time:{kind:'elapsed',reference:'Declared source origin',resolution:'',uncertainty:''}};
 const referenceColumn={name:'Reference interval',representation:'decimal',radix:10,unit:'reference interval',quantity:{...blankQuantity(),origin:'measured'},missing:[],time:{kind:'inferred-elapsed',reference:'Declared reference origin',resolution:'0.1',uncertainty:'reported',clock:{...blankClock(),wrap:'none',reset:'none',epoch:'Reference epoch'}}};
 const definition={version:1,method:'two-anchor-affine',source:{ref:source,column:3},anchors:[0,1].map(row=>({source:cell(source,row,3),reference:cell(reference,row,7)})),validity:{lower:scalar('10','radix',6),upper:scalar('20','radix',6)},target:{unit:referenceColumn.unit,quantity:structuredClone(referenceColumn.quantity),time:structuredClone(referenceColumn.time)},rationale:'Explicit observed pairings in one uninterrupted segment.',resourcePolicy:defaultDatasetResourcePolicy()};
 const content={tool:'Observanda clock synchronization',...definition};
 const context={content,sourceColumn,referenceColumn,anchors:[{source:value('10'),reference:value('100')},{source:value('20'),reference:value('160')}]};
 const reads=[],materials={read:async r=>{reads.push(['read',structuredClone(r)]);if(r.id===model.id)return {kind:'analysis',content};return {kind:'dataset',id:r.id};},datasetColumn:async(doc,column)=>{reads.push(['column',doc.id,column]);assert.equal(column,doc.id===source.id?3:7);return doc.id===source.id?sourceColumn:referenceColumn;},retainedDatasetPage:async(doc,page,{columns})=>{reads.push(['page',doc.id,page,columns]);assert.equal(page,0);assert.deepEqual(columns,[doc.id===source.id?3:7]);return {rows:context.anchors.map(pair=>({cells:[doc.id===source.id?pair.source.value:pair.reference.value],valueKinds:['string'],excluded:null}))};}};
 return {definition,content,context,sourceColumn,referenceColumn,materials,reads};
}
test('explicit paired cells retain original numeral spelling and exact interpolation',async()=>{
 const f=fixture(),original=structuredClone(f.definition);assert.equal(validClockSynchronization(f.definition),true);
 const saved=await prepareClockSynchronization(f.materials,f.definition);assert.deepEqual(saved,f.content);assert.deepEqual(f.definition,original);
 const verified=await verifyClockSynchronization(f.materials,saved);
 assert.equal(evaluateClockSynchronization(node,f.sourceColumn,verified,value('13')).value,'130/1');
 assert.equal(evaluateClockSynchronization(node,f.sourceColumn,verified,value('10')).value,'100/1');
 assert.equal(evaluateClockSynchronization(node,f.sourceColumn,verified,value('20')).value,'160/1');
 assert.equal(f.reads.filter(r=>r[0]==='page').length,8);assert.deepEqual(saved.validity,original.validity);
});
test('affine calculation preserves rational offsets and positive fractional slope',()=>{
 const f=fixture();f.sourceColumn.representation='rational';f.sourceColumn.radix=10;f.referenceColumn.representation='rational';
 f.context.anchors=[{source:value('1/3'),reference:value('-2/7')},{source:value('7/3'),reference:value('5/7')}];
 f.content.validity={lower:scalar('1/3','rational'),upper:scalar('7/3','rational')};
 assert.equal(evaluateClockSynchronization(node,f.sourceColumn,f.context,value('4/3')).value,'3/14');
 f.context.anchors.reverse();f.content.anchors.reverse();assert.equal(evaluateClockSynchronization(node,f.sourceColumn,f.context,value('4/3')).value,'3/14');
});
test('closed validity, missing and excluded statuses are distinct and outside errors are explicit',()=>{
 const f=fixture(),status={...node,operation:'status'};
 for(const input of ['10','20'])assert.equal(evaluateClockSynchronization(status,f.sourceColumn,f.context,value(input)).value,'ready');
 for(const input of ['5','21']){assert.equal(evaluateClockSynchronization(status,f.sourceColumn,f.context,value(input)).value,'outside-validity');assert.deepEqual(evaluateClockSynchronization(node,f.sourceColumn,f.context,value(input)),{kind:'absent',value:''});assert.throws(()=>evaluateClockSynchronization({...node,outside:'error'},f.sourceColumn,f.context,value(input)),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE'});}
 for(const input of [{kind:'null',value:''},{kind:'absent',value:''},value('NA')])assert.equal(evaluateClockSynchronization(status,f.sourceColumn,f.context,input).value,'missing-input');
 assert.equal(evaluateClockSynchronization(status,f.sourceColumn,f.context,value('invalid'),{excluded:true}).value,'excluded-input');
 assert.throws(()=>evaluateClockSynchronization(node,f.sourceColumn,f.context,value('invalid')),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});
});
test('zero or negative slope and extrapolating validity are refused',async()=>{
 for(const values of [['100','100'],['160','100']]){const f=fixture();f.context.anchors[0].reference.value=values[0];f.context.anchors[1].reference.value=values[1];await assert.rejects(prepareClockSynchronization(f.materials,f.definition),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR'});}
 const equal=fixture();equal.context.anchors[1].source.value='10';await assert.rejects(prepareClockSynchronization(equal.materials,equal.definition),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR'});
 for(const [lower,upper] of [['5','20'],['10','21'],['20','10']]){const f=fixture();f.definition.validity={lower:scalar(lower,'radix',6),upper:scalar(upper,'radix',6)};await assert.rejects(prepareClockSynchronization(f.materials,f.definition),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE'});}
 const f=fixture();f.definition.validity={lower:scalar('13','radix',6),upper:scalar('13','radix',6)};assert.equal((await prepareClockSynchronization(f.materials,f.definition)).validity.lower.spelling,'13');
});
test('selectors bind both anchors to immutable datasets and absolute columns',()=>{
 for(const mutate of [
  f=>f.definition.anchors[1].source.ref={...source,revision:'4'.repeat(64)},
  f=>f.definition.anchors[1].source.selector.column=4,
  f=>f.definition.anchors[1].reference.ref={...reference,revision:'4'.repeat(64)},
  f=>f.definition.anchors[1].reference.selector.column=8,
  f=>f.definition.anchors[1].source.selector.row=0,
  f=>f.definition.anchors[1].reference.selector.row=0,
  f=>f.definition.source.ref={...source,workspaceId:'invalid'},
  f=>f.definition.anchors[0].source.selector.row=256,
  f=>f.definition.rationale=' '
 ]){const f=fixture();mutate(f);assert.equal(validClockSynchronization(f.definition),false);}
});
test('counter, host calendar, unknown wrap and observed reset declarations are refused',()=>{
 for(const kind of ['counter','wall-clock','powered-duration','acquisition-order','unknown']){const f=fixture();assert.throws(()=>assertSynchronizationColumn({...f.sourceColumn,time:{...f.sourceColumn.time,kind}}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});}
 for(const [wrap,reset] of [['unknown','none'],['modulo','none'],['none','unknown'],['none','observed']]){const f=fixture();assert.throws(()=>assertSynchronizationColumn({...f.sourceColumn,time:{...f.sourceColumn.time,clock:{...blankClock(),wrap,reset}}}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});}
 const f=fixture();f.sourceColumn.time={...f.sourceColumn.time,kind:'external',clock:{...blankClock(),wrap:'none',reset:'none',model,referenceData:reference}};assert.doesNotThrow(()=>assertSynchronizationColumn(f.sourceColumn));
});
test('target declaration must be copied exactly from the pinned reference',async()=>{
 for(const mutate of [f=>f.definition.target.unit='other',f=>f.definition.target.time.clock.epoch='host epoch',f=>f.definition.target.quantity.origin='derived']){const f=fixture();mutate(f);await assert.rejects(prepareClockSynchronization(f.materials,f.definition),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR'});}
 const f=fixture();f.referenceColumn.quantity=undefined;delete f.definition.target.quantity;assert.equal(validClockSynchronization(f.definition),true);await prepareClockSynchronization(f.materials,f.definition);
});
test('output uses target declaration and new model while public descriptor excludes private IDs',()=>{
 const f=fixture(),output=clockSynchronizationColumn(node,f.sourceColumn,f.content);
 assert.equal(output.representation,'rational');assert.equal(output.unit,'reference interval');assert.equal(output.quantity.origin,'derived');assert.equal(output.time.clock.epoch,'Reference epoch');assert.deepEqual(output.time.clock.model,model);assert.deepEqual(output.time.clock.referenceData,reference);
 assert.equal(output.synchronization.sourceUnit,'device interval');assert.equal(output.synchronization.sourceReference,'Declared source origin');assert.equal(validClockSynchronizationDescriptor(output.synchronization),true);assert.doesNotThrow(()=>validateClockSynchronizationDescriptor(output.synchronization));
 const publicText=JSON.stringify(output.synchronization);for(const r of [source,reference,model]){assert.ok(!publicText.includes(r.id));assert.ok(!publicText.includes(r.revision));}
 const status=clockSynchronizationColumn({...node,operation:'status'},f.sourceColumn,f.content);assert.equal(status.domain.namespace,CLOCK_SYNCHRONIZATION_STATUS_NAMESPACE);assert.equal(status.unit,'');output.time.clock.epoch='mutated';assert.equal(f.content.target.time.clock.epoch,'Reference epoch');
});
test('approximate source and reference interpretations propagate and cannot be stripped on verification',async()=>{
 for(const side of ['sourceColumn','referenceColumn']){const f=fixture();f[side].computation={version:1,kind:'approximate',recipe:model};const saved=await prepareClockSynchronization(f.materials,f.definition);assert.deepEqual(saved.computation,{version:1,kind:'approximate-inputs'});const verified=await verifyClockSynchronization(f.materials,saved);assert.deepEqual(clockSynchronizationColumn(node,f.sourceColumn,verified.content).computation,saved.computation);delete saved.computation;await assert.rejects(verifyClockSynchronization(f.materials,saved),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});}
});
test('source scalar policy and consumer resource bounds cannot be borrowed or rounded',async()=>{
 const f=fixture(),tight={...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxOperations:1}};
 assert.throws(()=>evaluateClockSynchronization(node,f.sourceColumn,f.context,value('13'),{budget:new DatasetResourceBudget(tight)}),{code:'DATASET_CALCULATION_RESOURCE'});
 await assert.rejects(verifyClockSynchronization(f.materials,f.content,{policy:tight}),{code:'DATASET_CALCULATION_RESOURCE'});
 f.sourceColumn.resourcePolicy={...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxScalarCharacters:16}};
 assert.throws(()=>evaluateClockSynchronization(node,f.sourceColumn,f.context,value('0'.repeat(17)+'13')),{code:'DATASET_CALCULATION_RESOURCE'});
});
test('missing, excluded and inaccessible selected anchors refuse model creation',async()=>{
 for(const kind of ['null','absent']){const f=fixture(),page=f.materials.retainedDatasetPage;f.materials.retainedDatasetPage=async(...args)=>{const data=await page(...args);data.rows[1].valueKinds[0]=kind;return data;};await assert.rejects(prepareClockSynchronization(f.materials,f.definition),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR'});}
 const f=fixture(),page=f.materials.retainedDatasetPage;f.materials.retainedDatasetPage=async(...args)=>{const data=await page(...args);data.rows[1].excluded='explicit exclusion';return data;};await assert.rejects(prepareClockSynchronization(f.materials,f.definition),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR'});
 const denied=fixture();denied.materials.read=async()=>{throw Object.assign(new Error('denied'),{code:'DENIED'});};await assert.rejects(prepareClockSynchronization(denied.materials,denied.definition));
});
test('cached evaluation reparses exact anchors, rechecks pinned access and preserves symbol status',async()=>{
 const f=fixture(),verified=await verifyClockSynchronization(f.materials,f.content);f.reads.length=0;
 assert.equal((await calculateClockSynchronizationNode(f.materials,node,value('13'),f.sourceColumn,{verified,model:f.content})).value,'130/1');
 assert.deepEqual(f.reads.filter(r=>r[0]==='read').map(r=>r[1]),[model,source,reference]);assert.equal(f.reads.filter(r=>r[0]==='page').length,0);
 const status=await calculateClockSynchronizationNode(f.materials,{...node,operation:'status'},value('21'),f.sourceColumn,{verified});assert.equal(status.value.format,'domain-value');assert.equal(status.value.original,'outside-validity');assert.equal(status.value.definition.namespace,CLOCK_SYNCHRONIZATION_STATUS_NAMESPACE);
 const read=f.materials.read;f.materials.read=async r=>{if(r.id===reference.id)throw Object.assign(new Error('denied'),{code:'DENIED'});return read(r);};await assert.rejects(calculateClockSynchronizationNode(f.materials,node,value('13'),f.sourceColumn,{verified}));
});
test('cancellation and changed cached declaration refuse calculation before retained output',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(prepareClockSynchronization(f.materials,f.definition,{signal:controller.signal}),{name:'AbortError'});
 const verified=await verifyClockSynchronization(f.materials,f.content);await assert.rejects(calculateClockSynchronizationNode(f.materials,node,value('13'),f.sourceColumn,{verified,signal:controller.signal}),{name:'AbortError'});
 const wrong=structuredClone(f.sourceColumn);wrong.unit='other';assert.throws(()=>evaluateClockSynchronization(node,wrong,verified,value('13')),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});
 f.content.rationale='different';await assert.rejects(calculateClockSynchronizationNode(f.materials,node,value('13'),f.sourceColumn,{verified}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});
});


test('retained bounds and copied target scalars preserve complete spelling and selected storage',async()=>{
 const {MaterialSequence}=await import('../src/material-sequence.js'),{retainDatasetCell}=await import('../src/dataset-cell-storage.js'),{retainScalarDefinitions,readScalarDefinition}=await import('../src/measurement-scalar-storage.js');
 const f=fixture(),values=new Map(),workspace={readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,text)=>values.set(key,text)};
 Object.assign(f.materials,{workspace,sequences:new MaterialSequence(workspace)});
 const policy=defaultDatasetResourcePolicy();policy.resources.maxScalarCharacters=12000;policy.resources.maxOperations=200000;
 f.definition.resourcePolicy=policy;f.sourceColumn.resourcePolicy=policy;
 const long='0'.repeat(9000)+'10';f.definition.validity.lower=scalar(long,'radix',6);f.context.anchors[0].source=await retainDatasetCell(f.materials,value(long),fn=>fn());
 const longUnit='0'.repeat(9000)+'1';f.referenceColumn.quantity.unitDefinition={version:2,kind:'difference',dimensions:[{axis:'reference.interval',exponent:1}],scale:scalar(longUnit),offset:scalar('0'),resourcePolicy:policy};
 Object.assign(f.referenceColumn,await retainScalarDefinitions(f.materials,f.referenceColumn,fn=>fn()));
 f.definition.target.quantity=structuredClone(f.referenceColumn.quantity);
 const saved=await prepareClockSynchronization(f.materials,f.definition);
 assert.equal(saved.validity.lower.spelling.format,'dataset-cell');assert.equal(saved.target.quantity.unitDefinition.scale.spelling.format,'dataset-cell');
 assert.equal((await readScalarDefinition(f.materials,saved,'validity.lower.spelling',{offset:8998,limit:4})).text,'0010');
 const verified=await verifyClockSynchronization(f.materials,saved);assert.equal(verified.content.validity.lower.spelling,long);assert.equal(verified.content.target.quantity.unitDefinition.scale.spelling,longUnit);
 assert.equal(evaluateClockSynchronization(node,f.sourceColumn,verified,value('13')).value,'130/1');
 const {tool,...again}=saved;await assert.rejects(prepareClockSynchronization(f.materials,again),{code:'MATERIAL_INVALID'});
 assert.deepEqual(await prepareClockSynchronization(f.materials,again,{base:saved}),saved);
 const damaged=structuredClone(saved);damaged.validity.lower.spelling.sha256='0'.repeat(64);await assert.rejects(verifyClockSynchronization(f.materials,damaged),{code:'MATERIAL_MISSING'});
 for(const text of values.values())assert.ok(Buffer.byteLength(text)<1048576);
});
test('legacy source limits remain bounded even when the model allows longer original text',()=>{
 const f=fixture();f.content.resourcePolicy.resources.maxScalarCharacters=12000;f.content.resourcePolicy.resources.maxOperations=200000;
 assert.throws(()=>evaluateClockSynchronization(node,f.sourceColumn,f.context,value('0'.repeat(9000)+'13')),{code:'DATASET_CALCULATION_RESOURCE'});
 f.sourceColumn.resourcePolicy=structuredClone(f.content.resourcePolicy);assert.equal(evaluateClockSynchronization(node,f.sourceColumn,f.context,value('0'.repeat(9000)+'13')).value,'130/1');
});
