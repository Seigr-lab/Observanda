import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {retainTopologyValue} from '../src/measurement-topology-storage.js';
import {sequenceValuePage,verifySequenceValue} from '../src/measurement-sequence-storage.js';
import {topologyOperationColumn,calculateTopologyNode} from '../src/measurement-topology-operations.js';
const policy=()=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxOperations:1000000}});
function scratch(){const values=new Map();return {async get(key){return values.get(key);},async put(key,value){values.set(key,value);},async add(key,value){if(values.has(key))return false;values.set(key,value);return true;}};}
async function fixture(){const files=new Map(),workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,text)=>files.set(key,text)},materials={sequences:new MaterialSequence(workspace)},definition={version:4,codec:'observanda.topology',codecVersion:1,namespace:'test.topology.vertices',direction:'directed',loops:'allow',parallelEdges:'allow',resourcePolicy:policy()},column={...defaultColumn({label:'Observed relations'}),representation:'domain',domain:definition,quantity:blankQuantity()},data={vertices:['C','A','B','D'].map(key=>({key})),edges:[{key:'ab1',from:'A',to:'B'},{key:'ab2',from:'A',to:'B'},{key:'ba',from:'B',to:'A'},{key:'aa',from:'A',to:'A'},{key:'cd',from:'C',to:'D'}]},value=await retainTopologyValue(materials,{kind:'string',value:JSON.stringify(data)},definition,fn=>fn(),{work:scratch()});return {materials,column,cell:{kind:'string',value}};}
const node=operation=>({kind:'domain-topology',operation});
test('topology graph outputs use exact counts, explicit direction and existing vertex identity',async()=>{
 const f=await fixture(),run=operation=>calculateTopologyNode(f.materials,node(operation),f.cell,f.column,{policy:policy(),work:scratch()});
 for(const [operation,expected]of [[{kind:'count',collection:'vertices'},'4'],[{kind:'count',collection:'edges'},'5'],[{kind:'degree',vertex:'A',direction:'all'},'5'],[{kind:'reachable',from:'A',to:'B',direction:'out'},'1'],[{kind:'reachable',from:'B',to:'D',direction:'all'},'0']])assert.deepEqual(await run(operation),{kind:'string',value:expected});
 await assert.rejects(run({kind:'reachable',from:'missing',to:'missing',direction:'out'}),{code:'MEASUREMENT_TOPOLOGY_KEY'});
});
test('topology graph streams complete unique neighbor and reachable sets into native symbolic sequences',async()=>{
 const f=await fixture();for(const [operation,keys]of [[{kind:'neighbors',vertex:'A',direction:'all'},['A','B']],[{kind:'reachability',from:'D',direction:'all'},['C','D']],[{kind:'neighbors',vertex:'B',direction:'out'},['A']]]){const result=await calculateTopologyNode(f.materials,node(operation),f.cell,f.column,{policy:policy(),work:scratch()});assert.equal(result.value.definition.codec,'observanda.sequence');assert.equal(result.value.definition.namespace,f.column.domain.namespace);assert.deepEqual((await sequenceValuePage(f.materials,result.value)).items.map(item=>item.spelling),keys);await verifySequenceValue(f.materials,result.value);}
});
test('topology graph refuses undeclared numerical units and preserves absence, access and cancellation',async()=>{
 const f=await fixture(),operation=node({kind:'count',collection:'vertices'});assert.throws(()=>topologyOperationColumn(operation,{...f.column,unit:'V'},{policy:policy()}),{code:'MEASUREMENT_TOPOLOGY_UNITS'});assert.deepEqual(await calculateTopologyNode(f.materials,operation,{kind:'null',value:''},f.column,{policy:policy(),work:scratch()}),{kind:'absent',value:''});
 const denied=Object.assign(Error('Access revoked'),{code:'RECORD_OWNER_DENIED'});await assert.rejects(calculateTopologyNode(f.materials,operation,f.cell,f.column,{policy:policy(),work:scratch(),check:()=>{throw denied;}}),error=>error===denied);const controller=new AbortController();controller.abort();await assert.rejects(calculateTopologyNode(f.materials,operation,f.cell,f.column,{policy:policy(),work:scratch(),signal:controller.signal}),{name:'AbortError'});
});
