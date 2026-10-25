import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell,readDatasetCell} from '../src/dataset-cell-storage.js';
import {alignmentContext,alignmentContextSet,alignmentDecisionSet} from '../src/coordinate-alignment.js';
import {ClockTransitionReader,graphClockCell} from '../src/measurement-clock-operations.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankClock} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const policy=defaultDatasetResourcePolicy(),write=fn=>fn(),scalar=spelling=>({spelling,representation:'rational',radix:10}),source={kind:'dataset',id:randomUUID(),revision:'b'.repeat(64)},graph={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)},address={id:randomUUID(),position:1};
const node={kind:'clock',column:0,operation:'interval',transition:{version:1,wraps:{kind:'column',column:18},resets:{kind:'column',column:19},ambiguity:'absent'}};
async function fixture(){
 const objects=new Map(),materials={sequences:new MaterialSequence({readMetadata:async key=>objects.get(key)??null,writeMetadata:async(key,text)=>objects.set(key,text)})},binding={id:address.id,source,view:'observations',match:{method:'coordinate-neighbor-v1',keysIndex:{count:0},unmatched:'keep',coordinate:{left:{id:randomUUID(),position:0},right:0,direction:'nearest',tolerance:scalar('1/1'),toleranceUnit:blankUnitDefinition(),ties:'first-source',missing:'skip',excluded:'skip'}}},decisions=alignmentDecisionSet(materials),contexts=alignmentContextSet(materials),context=await contexts.leaf(alignmentContext(binding,address.position,graph,policy)),markers=[];
 for(let ordinal=0;ordinal<4;ordinal++){const evidence=materials.sequences.builder('coordinate-alignment-evidence',write);await evidence.append({ordinal,source:{ref:source,selector:{kind:'cell',page:0,row:ordinal,column:0}},computation:null});markers.push({version:1,decisionsIndex:await decisions.leaf({graph,binding:address,receipt:{version:1,status:'matched',delta:scalar(ordinal+'/1'),tieCount:1,decisionComputation:ordinal===2?{version:1,kind:'approximate-inputs'}:null,evidenceIndex:await evidence.finish()}})});}
 const marker={version:1,contextsIndex:context},column={...defaultColumn({label:'Counter'}),representation:'integer',unit:'ticks',coordinateAlignment:marker,time:{kind:'counter',reference:'Instrument A',resolution:'',uncertainty:'',clock:{...blankClock(),definition:{version:1,modulus:exactUnitScalar('10'),rate:{counts:exactUnitScalar('2'),interval:exactUnitScalar('1'),unit:'sample interval'}}}}},control={...defaultColumn({label:'Control'}),representation:'integer',coordinateAlignment:marker},cell=(value,index)=>({kind:'string',value,coordinateAlignment:markers[index]}),values={hasCurrent:true,hasPrevious:true,current:cell('3',0),previous:cell('8',1),wraps:cell('1',2),resets:cell('0',3)},run=(changes={},options={})=>graphClockCell({materials:{}},node,binding,null,column,[control,control],{alignment:true,evaluationMaterials:materials,write,resourcePolicy:policy,clockReader:{read:async()=>({...values,...changes})},...options}),entries=async result=>(await decisions.page(result.coordinateAlignment.decisionsIndex,{limit:16})).items;
 return {materials,binding,column,control,cell,values,markers,run,entries};
}

test('clock transitions union current/previous and consulted controls without changing payload computation',async()=>{
 const f=await fixture(),result=await f.run();assert.equal(result.value,'5/2');assert.equal(result.kind,'string');assert.equal(Object.hasOwn(result,'computation'),false);assert.equal(result.coordinateAlignment.decisionsIndex.count,4);const entries=await f.entries(result);assert.deepEqual(entries.map(item=>item.receipt.delta.spelling).sort(),['0/1','1/1','2/1','3/1']);assert.equal(entries.filter(item=>item.receipt.decisionComputation!==null).length,1);
 for(const [operation,expected]of [['ticks','5'],['status','ready']]){const alternate=await graphClockCell({materials:f.materials},{...node,operation},f.binding,null,f.column,[f.control,f.control],{alignment:true,write,clockReader:{read:async()=>f.values}});assert.equal(alternate.value,expected);assert.equal(alternate.coordinateAlignment.decisionsIndex.count,4);}
 const repeated=await f.run({resets:f.cell('0',2)});assert.equal(repeated.coordinateAlignment.decisionsIndex.count,3,'only identical receipts deduplicate');
});

test('clock transition decisions follow missing, invalid control, reset and early-return branches',async()=>{
 const f=await fixture();for(const change of [{hasCurrent:false},{hasPrevious:false},{currentExcluded:true},{previousExcluded:true}]){const result=await f.run(change);assert.equal(result.kind,'absent');assert.equal(result.coordinateAlignment.decisionsIndex.count,0);}
 const missing=await f.run({current:{...f.cell('',0),kind:'absent'}});assert.equal(missing.kind,'absent');assert.deepEqual((await f.entries(missing)).map(item=>item.receipt.delta.spelling).sort(),['0/1','1/1']);
 const badControl=await f.run({wraps:f.cell('-1',2)});assert.equal(badControl.kind,'absent');assert.deepEqual((await f.entries(badControl)).map(item=>item.receipt.delta.spelling).sort(),['0/1','1/1','2/1']);
 const reset=await f.run({resets:f.cell('1',3)});assert.equal(reset.kind,'absent');assert.equal(reset.coordinateAlignment.decisionsIndex.count,4);
 const plain={...f.column};delete plain.coordinateAlignment;const empty=await graphClockCell({materials:f.materials},node,f.binding,null,plain,[f.control,f.control],{alignment:true,write,clockReader:{read:async()=>({...f.values,hasPrevious:false})}});assert.equal(empty.coordinateAlignment.decisionsIndex.count,0,'aligned control declarations still require an explicit empty result marker');
});

test('clock reader preserves selected metadata and retained scalar decisions across two pages with fresh access checks',async()=>{
 const f=await fixture(),long='0'.repeat(5000)+'3',retained=await retainDatasetCell(f.materials,{kind:'string',value:long},write),pages=[{rows:[{id:'prior',cells:['8','0','0'],valueKinds:['string','string','string'],cellCoordinateAlignments:[f.markers[1],f.markers[2],f.markers[3]],excluded:null}]},{rows:[{id:'current',cells:[retained.value,'1','0'],valueKinds:['string','string','string'],cellCoordinateAlignments:[f.markers[0],f.markers[2],f.markers[3]],excluded:null}]}];let reads=0,pageReads=0,denied=false;
 Object.assign(f.materials,{read:async ref=>{assert.deepEqual(ref,source);reads++;if(denied)throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});return {};},retainedDatasetPage:async(doc,page,{columns})=>{assert.deepEqual(columns,[0,18,19]);pageReads++;return pages[page];},readDatasetCell:(value,options)=>readDatasetCell(f.materials,value,options)});
 const reader=new ClockTransitionReader(f.materials),location={kind:'dataset',page:1,row:0,id:'current',excluded:null};
 for(const resourcePolicy of [undefined,{...policy,resources:{...policy.resources,maxScalarCharacters:6000}}]){const selected=await reader.read(node,f.binding,location,{resourcePolicy});assert.equal(selected.current.value,long);assert.deepEqual(selected.current.coordinateAlignment,f.markers[0]);assert.deepEqual(selected.previous.coordinateAlignment,f.markers[1]);assert.deepEqual(selected.wraps.coordinateAlignment,f.markers[2]);}
 const result=await graphClockCell({materials:f.materials},node,f.binding,location,f.column,[f.control,f.control],{clockReader:reader,alignment:true,write});assert.equal(result.value,'5/2');assert.equal(result.coordinateAlignment.decisionsIndex.count,4);assert.equal(reads,3);assert.equal(pageReads,2);assert.equal(reader.pages.size,2);
 denied=true;await assert.rejects(reader.read(node,f.binding,location),{code:'ACCESS_LOCKED'});
});

test('clock alignment refuses historical use, dropped or mismatched metadata, cancellation and access failures',async()=>{
 const f=await fixture();await assert.rejects(f.run({}, {alignment:false}),{code:'DATASET_CALCULATION'});const dropped={...f.values.current};delete dropped.coordinateAlignment;await assert.rejects(f.run({current:dropped}),{code:'MATERIAL_MISSING'});await assert.rejects(f.run({current:{...f.values.current,coordinateAlignment:null}}),{code:'MATERIAL_MISSING'});
 const plain={...f.column};delete plain.coordinateAlignment;const plainControl={...f.control};delete plainControl.coordinateAlignment;for(const alignment of [false,true])await assert.rejects(graphClockCell({materials:f.materials},node,f.binding,null,plain,[plainControl,plainControl],{alignment,write,clockReader:{read:async()=>f.values}}),{code:alignment?'MATERIAL_MISSING':'DATASET_CALCULATION'});
 const controller=new AbortController();await assert.rejects(f.run({}, {signal:controller.signal,clockReader:{read:async()=>{controller.abort();return f.values;}}}),{name:'AbortError'});await assert.rejects(f.run({}, {clockReader:{read:async()=>{throw Object.assign(Error('Denied'),{code:'ACCESS_LOCKED'});}}}),{code:'ACCESS_LOCKED'});
});
