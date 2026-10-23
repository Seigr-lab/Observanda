import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDomainValue,domainValuePage,verifyDomainValue} from '../src/measurement-domain-storage.js';
import {readDatasetCell} from '../src/dataset-cell-storage.js';
import {calculateDomainAlgebraNode,domainAlgebraColumn} from '../src/measurement-domain-algebra.js';
import {domainAlgebraShape} from '../src/web/measurement-domain-algebra-model.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const policy=resources=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxOperations:200000,...resources}});
const definition=(codec,shape,component={version:1,representation:'rational',radix:10},resources)=>({...defaultDomain(codec),version:2,resourcePolicy:policy(resources),namespace:'declared-space',shape,component});
function fixture(){const data=new Map(),workspace={readMetadata:async key=>data.get(key)??null,writeMetadata:async(key,text)=>data.set(key,text)},materials={workspace,sequences:new MaterialSequence(workspace)};return {materials,data};}
async function operand(materials,codec,shape,values,{component,resources,quantity=blankQuantity(),unit='',version=2}={}){const domain=definition(codec,shape,component,resources);if(version===1){domain.version=1;delete domain.resourcePolicy;}const column={...defaultColumn({label:'Source'}),representation:'domain',domain,quantity,unit},cell={kind:'string',value:await retainDomainValue(materials,{kind:'string',value:JSON.stringify(values)},domain,fn=>fn())};return {column,cell};}
async function run(materials,operation,left,right,options={}){return calculateDomainAlgebraNode(materials,{operation},[left.cell,right.cell],[left.column,right.column],{policy:policy(),...options});}
async function spellings(materials,cell){if(cell.value?.format!=='domain-value')return cell.value;const out=[];for(let offset=0;;){const page=await domainValuePage(materials,cell.value,{offset,limit:16,resolve:true});out.push(...page.items.map(item=>item.spelling));if(page.next===null)return out;offset=page.next;}}
const typed=(kind,scale='1',offset='0',axis='length')=>({...blankQuantity(),origin:'measured',unitDefinition:{...blankUnitDefinition(),version:2,resourcePolicy:policy(),kind,dimensions:[{axis,exponent:1}],scale:exactUnitScalar(scale),offset:exactUnitScalar(offset)}});

test('vector arithmetic preserves radix-six source meaning and produces exact rational sum and dot',async()=>{
 const {materials}=fixture(),component={version:1,representation:'radix-fraction',radix:6},left=await operand(materials,'vector',[2],['10','0.3'],{component}),right=await operand(materials,'vector',[2],['1','0.3'],{component}),saved=structuredClone(left.cell);
 const sum=await run(materials,'add',left,right);assert.deepEqual(await spellings(materials,sum),['7/1','1/1']);assert.equal(await spellings(materials,await run(materials,'dot',left,right)),'25/4');assert.deepEqual(left.cell,saved);assert.equal(sum.value.definition.component.representation,'rational');await verifyDomainValue(materials,sum.value);
});

test('matrix multiplication uses row-major indexing and preserves noncommuting and rectangular products',async()=>{
 const {materials}=fixture(),a=await operand(materials,'matrix',[2,2],[['1/1','2/1'],['3/1','4/1']]),b=await operand(materials,'matrix',[2,2],[['0/1','1/1'],['1/1','0/1']]);
 assert.deepEqual(await spellings(materials,await run(materials,'matmul',a,b)),['2/1','1/1','4/1','3/1']);assert.deepEqual(await spellings(materials,await run(materials,'matmul',b,a)),['3/1','4/1','1/1','2/1']);
 const left=await operand(materials,'matrix',[2,3],[['1/1','2/1','3/1'],['4/1','5/1','6/1']]),right=await operand(materials,'matrix',[3,2],[['7/1','8/1'],['9/1','10/1'],['11/1','12/1']]),result=await run(materials,'matmul',left,right);
 assert.deepEqual(result.value.definition.shape,[2,2]);assert.deepEqual(await spellings(materials,result),['58/1','64/1','139/1','154/1']);assert.equal((await readDatasetCell(materials,result.value.original)).text,'[["58/1","64/1"],["139/1","154/1"]]');await verifyDomainValue(materials,result.value);
});

test('complex division, multiplication and component-dependent nulls remain exact',async()=>{
 const {materials}=fixture(),a=await operand(materials,'complex',[2],['1/1','1/1']),b=await operand(materials,'complex',[2],['1/1','-1/1']),zero=await operand(materials,'complex',[2],['0/1','0/1']),partial=await operand(materials,'complex',[2],[null,'2/1']);
 assert.deepEqual(await spellings(materials,await run(materials,'divide',a,b)),['0/1','1/1']);assert.deepEqual(await spellings(materials,await run(materials,'multiply',a,b)),['2/1','0/1']);await assert.rejects(run(materials,'divide',a,zero),{code:'MEASUREMENT_DOMAIN_ZERO_DIVISOR'});await assert.rejects(run(materials,'divide',partial,zero),{code:'MEASUREMENT_DOMAIN_ZERO_DIVISOR'});
 const sum=await run(materials,'add',partial,a);assert.deepEqual(await spellings(materials,sum),[null,'3/1']);assert.equal(sum.value.complete,false);assert.deepEqual(await spellings(materials,await run(materials,'multiply',partial,a)),[null,null]);assert.deepEqual(await run(materials,'dot',await operand(materials,'vector',[2],[null,'1/1']),await operand(materials,'vector',[2],['1/1','1/1'])),{kind:'null',value:''});
});

test('declared units retain absolute/difference arithmetic and canonical product dimensions without inherited calibration',async()=>{
 const {materials}=fixture(),absolute=await operand(materials,'vector',[1],['10/1'],{quantity:typed('absolute','1','100','temperature'),unit:'origin-A'}),difference=await operand(materials,'vector',[1],['3/1'],{quantity:typed('difference','2','0','temperature'),unit:'step-B'}),other=await operand(materials,'vector',[1],['110/1'],{quantity:typed('absolute','1','0','temperature'),unit:'origin-C'});
 const addColumn=domainAlgebraColumn({operation:'add'},[absolute.column,difference.column],{policy:policy()});assert.equal(addColumn.unit,'origin-A');assert.equal(addColumn.quantity.unitDefinition.kind,'absolute');assert.equal(addColumn.quantity.conversion,null);assert.equal(addColumn.quantity.calibration,null);
 assert.deepEqual(await spellings(materials,await run(materials,'add',absolute,difference)),['16/1']);assert.deepEqual(await spellings(materials,await run(materials,'add',difference,absolute)),['16/1']);const sub=domainAlgebraColumn({operation:'subtract'},[absolute.column,other.column],{policy:policy()});assert.equal(sub.quantity.unitDefinition.kind,'difference');assert.equal(sub.quantity.unitDefinition.offset.spelling,'0');assert.deepEqual(await spellings(materials,await run(materials,'subtract',absolute,other)),['0/1']);await assert.rejects(run(materials,'add',absolute,other),{code:'MEASUREMENT_DOMAIN_UNITS'});
 const length=await operand(materials,'vector',[1],['2/1'],{quantity:typed('difference','2'),unit:'length-label'}),time=await operand(materials,'vector',[1],['3/1'],{quantity:typed('difference','3','0','time'),unit:'time-label'}),product=domainAlgebraColumn({operation:'dot'},[length.column,time.column],{policy:policy()});assert.equal(product.unit,'');assert.deepEqual(product.quantity.unitDefinition.dimensions,[{axis:'length',exponent:1},{axis:'time',exponent:1}]);assert.equal(await spellings(materials,await run(materials,'dot',length,time)),'36/1');await assert.rejects(run(materials,'dot',absolute,other),{code:'MEASUREMENT_DOMAIN_UNITS'});
 const named=await operand(materials,'vector',[1],['1/1'],{unit:'uninterpreted'});await assert.rejects(run(materials,'dot',named,named),{code:'MEASUREMENT_DOMAIN_UNITS'});await assert.rejects(run(materials,'add',length,named),{code:'MEASUREMENT_DOMAIN_UNITS'});
});

test('shape, codec and namespace mismatches refuse without broadcasting or assigning unsupported meaning',()=>{
 const a=definition('vector',[2]),b=definition('vector',[3]);assert.throws(()=>domainAlgebraShape('add',a,b),{code:'MEASUREMENT_DOMAIN_INCOMPATIBLE'});assert.throws(()=>domainAlgebraShape('multiply',a,a),{code:'MEASUREMENT_DOMAIN_INCOMPATIBLE'});assert.throws(()=>domainAlgebraShape('dot',a,{...a,namespace:'another-space'}),{code:'MEASUREMENT_DOMAIN_INCOMPATIBLE'});assert.throws(()=>domainAlgebraShape('add',a,{...a,codecVersion:2}),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});assert.throws(()=>domainAlgebraShape('add',defaultDomain('symbol'),defaultDomain('symbol')),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});
});

test('one output budget includes every dot term and selected parse even after a missing component',async()=>{
 const {materials}=fixture(),component={version:1,representation:'integer',radix:10},left=await operand(materials,'vector',[2],[null,'1'+'0'.repeat(30)],{component}),right=await operand(materials,'vector',[2],['1','1'],{component});await assert.rejects(run(materials,'dot',left,right,{policy:policy({maxBits:64})}),{code:'DATASET_CALCULATION_RESOURCE'});
 const many=await operand(materials,'vector',[17],Array(17).fill('1/1'));await assert.rejects(run(materials,'dot',many,many,{policy:policy({maxOperations:100})}),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(await spellings(materials,await run(materials,'dot',many,many)),'17/1');
 const forged=structuredClone(right);forged.column.domain.resourcePolicy.resources.maxScalarCharacters=16;forged.cell.value.definition=structuredClone(forged.column.domain);forged.cell.value.components=left.cell.value.components;await assert.rejects(run(materials,'dot',forged,right),{code:'DATASET_CALCULATION_RESOURCE'});
});

test('component reads stay paged, cancellation interrupts streaming and retry produces the complete value',async()=>{
 const {materials}=fixture(),left=await operand(materials,'vector',[65],Array(65).fill('1/1')),right=await operand(materials,'vector',[65],Array(65).fill('2/1')),page=materials.sequences.page.bind(materials.sequences),requests=[];materials.sequences.page=async(ref,options)=>{if(ref.kind==='domain-components'){requests.push(options);assert.ok(options.limit<=16);}return page(ref,options);};
 const result=await run(materials,'add',left,right);assert.equal(requests.length,10);assert.deepEqual(await spellings(materials,result),Array(65).fill('3/1'));
 const controller=new AbortController();let checks=0;await assert.rejects(run(materials,'add',left,right,{signal:controller.signal,check:async()=>{if(++checks===25)controller.abort();}}),{name:'AbortError'});const retried=await run(materials,'add',left,right);assert.deepEqual(retried,result);await verifyDomainValue(materials,retried.value);
});

test('long exact output components use existing complete text sequences and verify after fresh reader construction',async()=>{
 const f=fixture(),spelling='9'.repeat(5000),component={version:1,representation:'integer',radix:10},left=await operand(f.materials,'vector',[1],[spelling],{component}),right=await operand(f.materials,'vector',[1],['0'],{component}),result=await run(f.materials,'add',left,right),fresh={workspace:f.materials.workspace,sequences:new MaterialSequence(f.materials.workspace)};
 assert.equal(result.value.original.format,'dataset-cell');const item=await fresh.sequences.item(result.value.components,0);assert.equal(item.spelling.format,'dataset-cell');assert.equal((await spellings(fresh,result))[0],spelling+'/1');await verifyDomainValue(fresh,result.value);
});
