import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {defaultDomain,validDomainDefinition,knownDomain,domainCapabilities,domainComponentIndex,domainComponentPosition,domainComponentCount} from '../src/web/measurement-domain-model.js';
import {domainAlgebraShape,domainReshapeShape} from '../src/web/measurement-domain-algebra-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {retainDomainValue,retainDomainComponents,verifyDomainValue,domainValuePage,domainValueReference,domainValueSupported} from '../src/measurement-domain-storage.js';
import {readDatasetCell} from '../src/dataset-cell-storage.js';
import {domainReshapeColumn,calculateDomainReshapeNode} from '../src/measurement-domain-reshape.js';
import {domainAlgebraColumn,calculateDomainAlgebraNode} from '../src/measurement-domain-algebra.js';
const policy=resources=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxOperations:200000,...resources}});
const definition=(codec,shape,{version=codec==='tensor'?3:2,component={version:1,representation:'radix-fraction',radix:6},resources,namespace='declared-array'}={})=>({...defaultDomain(codec),version,shape,component,namespace,...(version!==1?{resourcePolicy:policy(resources)}:{})});
function fixture(){const data=new Map(),workspace={readMetadata:async key=>data.get(key)??null,writeMetadata:async(key,text)=>data.set(key,text)},materials={workspace,sequences:new MaterialSequence(workspace)};return {materials,data};}
function nested(shape,values){let index=0;const level=axis=>Array.from({length:shape[axis]},()=>axis===shape.length-1?values[index++]:level(axis+1));return level(0);}
async function operand(materials,codec,shape,values,options={}){const domain=definition(codec,shape,options);if(domain.version===1)delete domain.resourcePolicy;const column={...defaultColumn({label:'Declared values'}),representation:'domain',domain,unit:options.unit??'',quantity:options.quantity??blankQuantity(),...(options.computation?{computation:options.computation}:{})};return {column,cell:{kind:'string',value:await retainDomainValue(materials,{kind:'string',value:JSON.stringify(nested(shape,values))},domain,fn=>fn())}};}
async function all(materials,cell){const result=[];for(let offset=0;;){const page=await domainValuePage(materials,cell.value,{offset,limit:16,resolve:true});result.push(...page.items.map(value=>value.spelling));if(page.next===null)return result;offset=page.next;}}
const reshape=(materials,input,shape,options={})=>calculateDomainReshapeNode(materials,{shape},input.cell,input.column,{policy:policy(),...options});
const algebra=(materials,operation,left,right,options={})=>calculateDomainAlgebraNode(materials,{operation},[left.cell,right.cell],[left.column,right.column],{policy:policy(),...options});
test('tensor admission is explicit, policy-bearing and bounded to ranks three through sixteen',()=>{
 const tensor=defaultDomain('tensor');assert.equal(tensor.version,3);assert.equal(validDomainDefinition(tensor),true);assert.equal(knownDomain(tensor),true);assert.equal(domainCapabilities(tensor).ordering,false);
 for(const changed of [{shape:[2,2]},{shape:Array(17).fill(1)},{shape:[1,0,1]},{shape:[1,1,1.5]},{shape:[Number.MAX_SAFE_INTEGER,2,1]},{codec:'observanda.matrix'},{codecVersion:2},{resourcePolicy:undefined}])assert.equal(validDomainDefinition({...tensor,...changed}),false);
 const maximum={...tensor,shape:Array(16).fill(1)};assert.equal(validDomainDefinition(maximum),true);assert.equal(domainComponentCount(maximum),1);
 const large={...tensor,shape:[1000000,1000000,1]},position=[999999,999998,0];assert.equal(domainComponentCount(large),1000000000000);assert.deepEqual(domainComponentPosition(large,domainComponentIndex(large,position)),position);
});
test('historical named tensor declarations remain opaque and envelope mappings cannot be substituted',async()=>{
 const f=fixture();
 for(const version of [1,2]){const domain={...definition('vector',[2],{version}),codec:'observanda.tensor',shape:[1,1,2]};if(version===1)delete domain.resourcePolicy;assert.equal(validDomainDefinition(domain),true);assert.equal(knownDomain(domain),false);const retained=await retainDomainValue(f.materials,{kind:'string',value:'Opaque prior tensor syntax'},domain,fn=>fn());assert.equal(retained.version,version===1?1:3);assert.equal(retained.components,null);assert.equal(retained.identity,null);assert.equal(domainValueSupported(retained),false);assert.equal((await domainValuePage(f.materials,retained)).supported,false);await verifyDomainValue(f.materials,retained);assert.throws(()=>domainReshapeShape(domain,[2]),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});}
 const tensor=await operand(f.materials,'tensor',[1,1,2],['1','2']);assert.equal(tensor.cell.value.version,4);assert.equal(domainValueReference(tensor.cell.value),true);assert.equal(domainValueReference({...tensor.cell.value,version:3}),false);
 const vector=await operand(f.materials,'vector',[2],['1','2']);assert.equal(domainValueReference({...vector.cell.value,version:4}),false);
});
test('rank-three parsing retains original spelling, null positions and explicit component coordinates',async()=>{
 const f=fixture(),values=['00','01','0.3',null,'10','11','12','13'],source=await operand(f.materials,'tensor',[2,2,2],values);
 assert.deepEqual(await all(f.materials,source.cell),values);assert.equal(source.cell.value.complete,false);
 const page=await domainValuePage(f.materials,source.cell.value,{offset:3,limit:2});assert.deepEqual(page.items.map(v=>v.position),[[0,1,1],[1,0,0]]);assert.equal(page.items[1].exact,'6/1');await verifyDomainValue(f.materials,source.cell.value);
 for(const malformed of ['[[[1,2]],[[3,4]]]','[[[1,2],[3,4]],[[5,6],[7]]]','[[[1,2],[3,4]],[[5,6],[7,true]]]'])await assert.rejects(retainDomainValue(f.materials,{kind:'string',value:malformed},source.column.domain,fn=>fn()),{code:'MEASUREMENT_DOMAIN_INVALID'});
});
test('legacy vector and matrix reshape preserve their declaration generation and all component text',async()=>{
 const f=fixture(),values=['00','01','0.1',null,'10','11','12','13'],input=await operand(f.materials,'vector',[8],values,{version:1}),before=structuredClone(input);
 const column=domainReshapeColumn({shape:[2,4]},input.column,{policy:policy()}),matrix=await reshape(f.materials,input,[2,4]);assert.equal(column.domain.version,1);assert.equal(matrix.value.version,1);assert.deepEqual(column.domain.component,input.column.domain.component);
 assert.equal((await readDatasetCell(f.materials,matrix.value.original)).text,JSON.stringify(nested([2,4],values)));
 const back=await reshape(f.materials,{column,cell:matrix},[8]);assert.deepEqual(back,input.cell);assert.deepEqual(input,before);await verifyDomainValue(f.materials,matrix.value);
});
test('explicit vector to tensor to matrix keeps component order, source policy and scientific metadata',async()=>{
 const f=fixture(),values=['00','01','0.1',null,'10','11','12','13'],computation={version:1,kind:'approximate-inputs'},input=await operand(f.materials,'vector',[8],values,{version:1,unit:'authored unit',computation});
 input.column.time={kind:'elapsed',reference:'authored origin',resolution:'exact source spelling',uncertainty:''};
 const tensorColumn=domainReshapeColumn({shape:[2,2,2]},input.column,{policy:policy()}),tensor=await reshape(f.materials,input,[2,2,2]);assert.equal(tensorColumn.domain.version,3);assert.equal(tensor.value.version,4);assert.deepEqual(await all(f.materials,tensor),values);
 for(const key of ['unit','quantity','time','computation'])assert.deepEqual(tensorColumn[key],input.column[key]);assert.equal(tensorColumn.domain.namespace,input.column.domain.namespace);assert.deepEqual(tensorColumn.domain.component,input.column.domain.component);
 const tight=policy({maxBits:64}),matrixColumn=domainReshapeColumn({shape:[4,2]},tensorColumn,{policy:tight}),matrix=await reshape(f.materials,{column:tensorColumn,cell:tensor},[4,2],{policy:tight});assert.equal(matrixColumn.domain.version,2);assert.equal(matrix.value.version,3);assert.deepEqual(matrixColumn.domain.resourcePolicy,tensorColumn.domain.resourcePolicy);assert.deepEqual(await all(f.materials,matrix),values);await verifyDomainValue(f.materials,matrix.value);
});
test('reshape refuses invalid dimensions, cardinality changes and special or opaque domains',async()=>{
 const f=fixture(),input=await operand(f.materials,'vector',[8],Array(8).fill('1'));
 for(const shape of [[],[2,3],[0,8],[2,-4],[2,4.5],Array(17).fill(1),[Number.MAX_SAFE_INTEGER,2]])assert.throws(()=>domainReshapeColumn({shape},input.column,{policy:policy()}),{code:'MEASUREMENT_DOMAIN_INCOMPATIBLE'});
 for(const codec of ['complex','interval','symbol'])assert.throws(()=>domainReshapeShape(defaultDomain(codec),[2]),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});
 for(const kind of ['null','absent'])assert.deepEqual(await calculateDomainReshapeNode(f.materials,{shape:[2,4]},{kind,value:''},input.column,{policy:policy()}),{kind,value:''});
 assert.deepEqual(await calculateDomainReshapeNode(f.materials,{shape:[2,4]},{kind:'string',value:''},input.column,{policy:policy()}),{kind:'absent',value:''});
});
test('arbitrary-rank output nesting handles singleton axes and maximum rank without flattening the values',async()=>{
 const f=fixture();
 for(const shape of [[2,1,3],[1,2,1,2],Array(16).fill(1)]){
  const count=domainComponentCount({shape}),values=Array.from({length:count},(_,i)=>String(i)),domain=definition('tensor',shape,{component:{version:1,representation:'integer',radix:10}});
  async function* source(){for(const spelling of values)yield {spelling};}
  const result=await retainDomainComponents(f.materials,domain,source(),fn=>fn());assert.equal((await readDatasetCell(f.materials,result.original)).text,JSON.stringify(nested(shape,values)));await verifyDomainValue(f.materials,result);
 }
});
test('tensor elementwise add and subtract use each pinned radix and exact rational output',async()=>{
 const f=fixture(),a=await operand(f.materials,'tensor',[2,2,2],['10','0.3','1','2',null,'3','4','5']),b=await operand(f.materials,'tensor',[2,2,2],['1','0.5','1','2','3','4','5','6'],{component:{version:1,representation:'decimal',radix:10}});
 const sum=await algebra(f.materials,'add',a,b),difference=await algebra(f.materials,'subtract',a,b);assert.equal(sum.value.version,4);assert.equal(sum.value.definition.version,3);assert.equal(sum.value.definition.component.representation,'rational');
 assert.deepEqual(await all(f.materials,sum),['7/1','1/1','2/1','4/1',null,'7/1','9/1','11/1']);assert.deepEqual(await all(f.materials,difference),['5/1','0/1','0/1','0/1',null,'-1/1','-1/1','-1/1']);await verifyDomainValue(f.materials,sum.value);await verifyDomainValue(f.materials,difference.value);
});
test('tensor algebra reuses explicit absolute and difference unit rules',async()=>{
 const f=fixture(),quantity=(kind,scale,offset)=>({...blankQuantity(),origin:'measured',unitDefinition:{...blankUnitDefinition(),kind,scale:exactUnitScalar(scale),offset:exactUnitScalar(offset),dimensions:[{axis:'temperature',exponent:1}]}}),a=await operand(f.materials,'tensor',[1,1,1],['10'],{unit:'origin',quantity:quantity('absolute','1','100')}),b=await operand(f.materials,'tensor',[1,1,1],['2'],{unit:'step',quantity:quantity('difference','2','0')});
 const result=await algebra(f.materials,'add',a,b),column=domainAlgebraColumn({operation:'add'},[a.column,b.column],{policy:policy()});assert.deepEqual(await all(f.materials,result),['10/1']);assert.equal(column.quantity.unitDefinition.kind,'absolute');assert.equal(column.unit,'origin');assert.equal(column.quantity.calibration,null);await assert.rejects(algebra(f.materials,'add',a,a),{code:'MEASUREMENT_DOMAIN_UNITS'});
});
test('tensor algebra rejects broadcasting, inferred axes, namespace changes and unsupported products',()=>{
 const a=definition('tensor',[2,2,2]);
 for(const operation of ['dot','matmul','multiply','divide'])assert.throws(()=>domainAlgebraShape(operation,a,a),{code:'MEASUREMENT_DOMAIN_INCOMPATIBLE'});
 for(const b of [{...a,shape:[1,2,4]},{...a,namespace:'different'},definition('vector',[8])])assert.throws(()=>domainAlgebraShape('add',a,b),{code:'MEASUREMENT_DOMAIN_INCOMPATIBLE'});
 assert.throws(()=>domainAlgebraShape('add',a,{...a,version:2}),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});
});
test('reshape consumes bounded component pages and cancellation leaves retry on the same source',async()=>{
 const f=fixture(),values=Array.from({length:102},(_,i)=>String(i)),input=await operand(f.materials,'vector',[102],values,{component:{version:1,representation:'integer',radix:10}}),page=f.materials.sequences.page.bind(f.materials.sequences),requests=[];
 f.materials.sequences.page=async(ref,options)=>{if(ref.kind==='domain-components'){requests.push(options);assert.ok(options.limit<=16);}return page(ref,options);};
 const result=await reshape(f.materials,input,[2,3,17]);assert.equal(requests.length,7);assert.deepEqual(await all(f.materials,result),values);const controller=new AbortController();let checks=0;
 await assert.rejects(reshape(f.materials,input,[2,3,17],{signal:controller.signal,check:async()=>{if(++checks===25)controller.abort();}}),{name:'AbortError'});
 assert.deepEqual(await reshape(f.materials,input,[2,3,17]),result);await verifyDomainValue(f.materials,result.value);
});
test('long retained components keep their full spelling through reshape and detect digest substitution',async()=>{
 const f=fixture(),text='0'.repeat(9000)+'1',input=await operand(f.materials,'vector',[2],[text,'2'],{component:{version:1,representation:'integer',radix:10},resources:{maxScalarCharacters:12000}}),result=await reshape(f.materials,input,[1,1,2],{policy:policy({maxScalarCharacters:12000})});
 assert.equal(result.value.version,4);assert.equal(result.value.original.format,'dataset-cell');assert.equal((await f.materials.sequences.item(result.value.components,0)).spelling.format,'dataset-cell');assert.deepEqual(await all(f.materials,result),[text,'2']);await verifyDomainValue(f.materials,result.value);
 const page=f.materials.sequences.page.bind(f.materials.sequences);f.materials.sequences.page=async(ref,options)=>{const result=await page(ref,options);if(ref===input.cell.value.components&&options.offset===0){result.items[0]=structuredClone(result.items[0]);result.items[0].spelling.sha256='0'.repeat(64);}return result;};
 await assert.rejects(reshape(f.materials,input,[1,1,2],{policy:policy({maxScalarCharacters:12000})}),{code:'MATERIAL_MISSING'});
 for(const raw of f.data.values())assert.ok(Buffer.byteLength(raw)<1048576);
});
test('source and consumer policies both limit exact work without truncation or implicit precision changes',async()=>{
 const f=fixture(),input=await operand(f.materials,'vector',[2],['1'+'0'.repeat(40),'1'],{component:{version:1,representation:'integer',radix:10}});
 await assert.rejects(reshape(f.materials,input,[1,1,2],{policy:policy({maxBits:64})}),{code:'DATASET_CALCULATION_RESOURCE'});await assert.rejects(reshape(f.materials,input,[1,1,2],{policy:policy({maxOperations:1})}),{code:'DATASET_CALCULATION_RESOURCE'});
 const a=await operand(f.materials,'tensor',[1,1,2],['1','2']);await assert.rejects(algebra(f.materials,'add',a,a,{policy:policy({maxOperations:1})}),{code:'DATASET_CALCULATION_RESOURCE'});
 const controller=new AbortController();controller.abort();await assert.rejects(reshape(f.materials,input,[1,1,2],{signal:controller.signal}),{name:'AbortError'});
});
