import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MaterialSequence} from '../src/material-sequence.js';
import {Measurements} from '../src/measurements.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDomain,validDomainDefinition,knownDomain,domainCapabilities,domainComponentCount,domainComponentIndex} from '../src/web/measurement-domain-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {retainDomainValue,validateDomainValue,domainValueReference,domainValuePage,readDomainComponent,verifyDomainValue,domainValuesEqual,domainValueKey} from '../src/measurement-domain-storage.js';
import {retainDatasetCell,readDatasetCell} from '../src/dataset-cell-storage.js';
import {calculateDomainNode,compareDomainCells,domainOperationColumn} from '../src/measurement-domain-operations.js';
const policy={...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxScalarCharacters:12000,maxOperations:1000000,maxMilliseconds:30000}};
const declaration=(kind='numeric')=>({...defaultDomain('sequence'),namespace:'test.shared.sequence',element:kind==='numeric'?{kind,representation:'decimal',radix:10}:{kind},resourcePolicy:structuredClone(policy)});
function fixture(){const files=new Map(),workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,text)=>files.set(key,text)},materials={workspace,sequences:new MaterialSequence(workspace)},save=fn=>fn();return {materials,files,save,retain:(text,definition=declaration())=>retainDomainValue(materials,{kind:'string',value:text},definition,save)};}

test('shared codec dispatch admits variable counts without manufacturing a fixed shape',async()=>{
 const f=fixture(),definition=declaration();assert.equal(validDomainDefinition(definition),true);assert.equal(knownDomain(definition),true);assert.equal(Object.hasOwn(definition,'shape'),false);assert.equal(Object.hasOwn(definition,'component'),false);
 assert.deepEqual(domainCapabilities(definition),{supported:true,equality:true,ordering:false,copy:true,choose:true,extract:false,componentPlot:false});assert.throws(()=>domainComponentCount(definition));assert.throws(()=>domainComponentIndex(definition,[0]));assert.equal(validDomainDefinition({...definition,shape:[3]}),false);
 for(const [text,count,complete]of [['[]',0,true],['[1]',1,true],['[1,null,"03.00"]',3,false]]){
  const value=await f.retain(text,definition);assert.equal(value.version,5);assert.equal(value.count,count);assert.equal(value.components.count,count);assert.equal(value.complete,complete);assert.equal(domainValueReference(value),true);assert.equal(Object.hasOwn(value,'shape'),false);validateDomainValue(f.materials,value,definition);await verifyDomainValue(f.materials,value);const page=await domainValuePage(f.materials,value,{resolve:true});assert.equal(page.total,count);assert.equal(page.supported,true);assert.deepEqual(page.items.map(item=>item.position),Array.from({length:count},(_,index)=>[index]));assert.equal((await readDatasetCell(f.materials,value)).text,text);
  const copied=await retainDatasetCell(f.materials,{kind:'string',value},f.save);assert.equal(copied.kind,'string');assert.deepEqual(copied.value,value);assert.equal(copied.read,undefined);assert.deepEqual(await retainDomainValue(f.materials,copied,definition,f.save),value);
 }
 const value=await f.retain('[1]');assert.equal(domainValueReference({...value,version:4}),false);assert.throws(()=>validateDomainValue(f.materials,{...value,count:2}),{code:'MATERIAL_MISSING'});
});

test('existing domain copy, choose and equality preserve the ordered sequence space and unknown null equality',async()=>{
 const f=fixture(),definition=declaration(),column={...defaultColumn({label:'Ordered values'}),representation:'domain',domain:definition},a=await f.retain('[1,"02.00"]'),same=await f.retain('["01.0",2]'),different=await f.retain('[1,2,3]'),partial=await f.retain('[1,null]'),cell=value=>({kind:'string',value});
 assert.equal(domainValuesEqual(f.materials,a,same),true);assert.deepEqual(domainValueKey(f.materials,a,definition),domainValueKey(f.materials,same,definition));assert.equal(domainValuesEqual(f.materials,a,different),false);assert.equal(domainValuesEqual(f.materials,partial,partial),null);assert.equal(domainValueKey(f.materials,partial,definition),null);assert.equal(compareDomainCells(f.materials,cell(a),cell(same),[column,column],'eq'),true);
 const copy={operation:'copy'},choose={operation:'choose'};assert.deepEqual(domainOperationColumn(copy,[column]),column);assert.deepEqual(await calculateDomainNode(f.materials,copy,[cell(a)],[column]),cell(a));assert.deepEqual(await calculateDomainNode(f.materials,choose,[cell(a),cell(different),{kind:'string',value:'0'}],[column,column,defaultColumn({label:'Condition'})]),cell(different));
 assert.throws(()=>domainOperationColumn({operation:'extract',component:[0]},[column]),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});assert.throws(()=>domainValuesEqual(f.materials,a,{...same,definition:{...definition,namespace:'different'}}),{code:'MEASUREMENT_DOMAIN_INCOMPATIBLE'});
 const symbolic=declaration('symbol'),empty=await f.retain('[]',symbolic),emptySymbol=await f.retain('[""]',symbolic),nullSymbol=await f.retain('[null]',symbolic);assert.equal(domainValuesEqual(f.materials,empty,emptySymbol),false);assert.equal(domainValuesEqual(f.materials,nullSymbol,nullSymbol),null);assert.equal((await readDomainComponent(f.materials,emptySymbol,{component:0})).text,'');
});

test('existing measurement inspection pages sequence values and long selected text while old declarations remain opaque',async()=>{
 const f=fixture(),long='0'.repeat(5000)+'1',value=await f.retain(JSON.stringify(['01.00',long,null])),column={...defaultColumn({label:'Retained sequence'}),representation:'domain',domain:value.definition},ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},artifact={kind:'artifact',id:randomUUID(),revision:'b'.repeat(64)},row={id:randomUUID(),cells:[value],valueKinds:['string'],excluded:null},doc={kind:'dataset',id:ref.id,content:{datasetFormat:2,inputs:[artifact]}},m=f.materials;
 Object.assign(m,{read:async reference=>{assert.deepEqual(reference,ref);return doc;},retainedDatasetPage:async()=>({rows:[row]}),retainedSchemaPage:async()=>({items:[column]}),datasetPageCount:()=>1,readDatasetCell:(stored,options)=>readDatasetCell(m,stored,options)});
 const inspected=await new Measurements(m).inspect({ref,selector:{kind:'cell',page:0,row:0,column:0}},{componentOffset:1});assert.equal(inspected.kind,'cell');assert.equal(inspected.domain.total,3);assert.equal(inspected.domain.items[0].index,1);assert.equal(inspected.domain.items[0].spelling.format,'dataset-cell');assert.equal(inspected.domain.items[1].presence,'null');assert.equal(inspected.exact,null);assert.equal(inspected.column.domain.shape,undefined);assert.equal((await readDomainComponent(m,value,{component:1,offset:4999,limit:2})).text,'01');
 for(const version of [1,2]){
  const definition={...defaultDomain('vector'),version,codec:'observanda.sequence',...(version===2?{resourcePolicy:policy}:{})},opaque=await f.retain('not JSON; intentionally uninterpreted',definition);assert.equal(validDomainDefinition(definition),true);assert.equal(knownDomain(definition),false);assert.equal(opaque.version,version===1?1:3);assert.equal(opaque.components,null);assert.equal(opaque.identity,null);assert.equal((await domainValuePage(m,opaque)).supported,false);assert.equal((await readDatasetCell(m,opaque)).text,'not JSON; intentionally uninterpreted');await verifyDomainValue(m,opaque);assert.throws(()=>domainValueKey(m,opaque,definition),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});
 }
});
