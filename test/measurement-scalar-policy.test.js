import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/web/dataset-resource-budget.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
import {blankUnitDefinition,validUnitDefinition,validateUnitDefinition,canonicalUnitValue,unitScalar} from '../src/web/measurement-unit-model.js';
import {validateClockDefinition,clockRateIdentity} from '../src/web/measurement-clock-model.js';
import {validateIntervalUncertainty,blankIntervalUncertainty} from '../src/web/measurement-interval-model.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainScalarDefinitions,resolveScalarDefinitions,readScalarDefinition,scalarDefinitionSequences} from '../src/measurement-scalar-storage.js';
import {retainDomainValue,verifyDomainValue,domainValuePage,readDomainComponent} from '../src/measurement-domain-storage.js';
const policy=()=>{const p=defaultDatasetResourcePolicy();p.resources.maxScalarCharacters=12000;p.resources.maxExponent=12000;p.resources.maxOperations=200000;return p;};
const scalar=spelling=>({spelling,representation:'integer',radix:10});
const unit=()=>({...blankUnitDefinition(),version:2,resourcePolicy:policy()});
function fixture(){const values=new Map(),workspace={readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,text)=>{values.set(key,text);}},materials={workspace,sequences:new MaterialSequence(workspace)};return {values,materials};}
test('owned interpretation and caller resources both bound parsing and conversion without altering legacy scalars',()=>{
 const p=policy(),long=scalar('1'+'0'.repeat(9000));assert.throws(()=>unitScalar(long));assert.equal(validatePolicyScalar(long,p).numerator.toString(),long.spelling);
 const small=structuredClone(p);small.resources.maxBits=64;assert.throws(()=>validatePolicyScalar(long,p,{budget:new DatasetResourceBudget(small)}),{code:'DATASET_CALCULATION_RESOURCE'});assert.throws(()=>validatePolicyScalar(long,small,{budget:new DatasetResourceBudget(p)}),{code:'DATASET_CALCULATION_RESOURCE'});
 const u=unit();u.scale=scalar('16');const caller=new DatasetResourceBudget(small);assert.throws(()=>caller.run(()=>canonicalUnitValue({numerator:1n<<61n,denominator:1n},u,caller)),{code:'DATASET_CALCULATION_RESOURCE'});
 const zero=unit();zero.scale=scalar('0');assert.equal(validUnitDefinition(zero),true);assert.throws(()=>validateUnitDefinition(zero),RangeError);
 const clock={version:2,modulus:scalar('1'+'0'.repeat(9000)),rate:{counts:scalar('3'),interval:scalar('2'),unit:'s'},resourcePolicy:p};validateClockDefinition(clock);assert.deepEqual(clockRateIdentity(clock),{numerator:'3',denominator:'2',unit:'s',canonical:false});
 const uncertainty={...blankIntervalUncertainty(),version:2,resourcePolicy:p,method:{name:'Declared',version:'1',reference:null},coverage:{kind:'probability',level:scalar('2')}};assert.throws(()=>validateIntervalUncertainty(uncertainty),RangeError);
});
test('selected scalar definitions retain complete text, reject foreign refs and verify exact immutable text',async()=>{
 const f=fixture(),u=unit();u.scale=scalar('0'.repeat(9000)+'1');const retained=await retainScalarDefinitions(f.materials,u,fn=>fn());assert.equal(retained.scale.spelling.format,'dataset-cell');assert.equal([...scalarDefinitionSequences(retained)].length,1);
 assert.equal((await readScalarDefinition(f.materials,retained,'scale.spelling',{offset:8998,limit:3})).text,'001');assert.equal((await resolveScalarDefinitions(f.materials,retained)).scale.spelling,u.scale.spelling);
 await assert.rejects(retainScalarDefinitions(f.materials,retained,fn=>fn()),{code:'MATERIAL_INVALID'});assert.deepEqual(await retainScalarDefinitions(f.materials,retained,fn=>fn(),{base:retained}),retained);
 const wrong=structuredClone(retained);wrong.scale.spelling.sha256='0'.repeat(64);await assert.rejects(resolveScalarDefinitions(f.materials,wrong),{code:'MATERIAL_MISSING'});
 const controller=new AbortController();controller.abort();await assert.rejects(resolveScalarDefinitions(f.materials,retained,{signal:controller.signal}),{name:'AbortError'});
 const columns=f.materials.sequences.builder('columns-policy',fn=>fn());for(let i=0;i<9;i++)await columns.append({name:String(i),quantity:{unitDefinition:retained}});const ref=await columns.finish();assert.equal(ref.chunkSize,4);assert.equal(ref.count,9);for(const text of f.values.values())assert.ok(Buffer.byteLength(text)<1048576);
});
test('policy domain components page full original values without inflating component blocks',async()=>{
 const f=fixture(),domain={...defaultDomain('vector'),version:2,resourcePolicy:policy()},long='0'.repeat(9000)+'1',source=JSON.stringify([long,'2']),value=await retainDomainValue(f.materials,{kind:'string',value:source},domain,fn=>fn());assert.equal(value.version,3);
 const page=await domainValuePage(f.materials,value);assert.equal(page.items[0].spelling.format,'dataset-cell');assert.equal(page.items[0].exact,null);assert.equal((await readDomainComponent(f.materials,value,{component:0,offset:8998,limit:3})).text,'001');assert.equal((await domainValuePage(f.materials,value,{limit:1,resolve:true})).items[0].exact,'1/1');await verifyDomainValue(f.materials,value);
 for(const text of f.values.values())assert.ok(Buffer.byteLength(text)<1048576);
});


test('legacy recipes refuse owned scalar interpretation instead of silently ignoring its policy',async()=>{
 const {DatasetCalculations}=await import('../src/dataset-calculations.js'),{defaultColumn}=await import('../src/web/dataset-schema.js');const original={...defaultColumn({label:'Original'}),representation:'integer'},owned={...original,resourcePolicy:policy()},source={kind:'dataset',id:'source',revision:'fixed'};
 const materials={read:async ref=>({kind:'dataset',columns:ref.id==='source'?[owned]:[original]}),datasetColumns:async doc=>doc.columns},engine=new DatasetCalculations(materials);
 for(const version of [1,2,3])await assert.rejects(engine.recipeColumns({version,source,view:'observations',joins:[],steps:[],where:null,calibration:null}),{code:'DATASET_SCALAR_POLICY_VERSION'});
 const legacy={version:3,source:{...source,id:'ordinary'},view:'observations',joins:[],steps:[],where:null,calibration:null};assert.deepEqual(await engine.recipeColumns(legacy),[original]);
 await assert.rejects(engine.recipeColumns({...legacy,steps:[{name:'Owned conversion',quantity:{origin:'derived',conversion:null,calibration:null,unitDefinition:unit()}}]}),{code:'DATASET_SCALAR_POLICY_VERSION'});
});


test('invalid declarations normalize at storage boundaries without hiding resource or cancellation failures',async()=>{
 const {materials}=fixture(),invalid=unit();invalid.scale=scalar('0');
 await assert.rejects(resolveScalarDefinitions(materials,invalid),{code:'MATERIAL_MISSING'});
 await assert.rejects(retainScalarDefinitions(materials,invalid,fn=>fn()),{code:'MATERIAL_INVALID'});
 const limited=unit();limited.scale=scalar('1'+'0'.repeat(9000));limited.resourcePolicy.resources.maxBits=64;
 await assert.rejects(resolveScalarDefinitions(materials,limited),{code:'DATASET_CALCULATION_RESOURCE'});
 await assert.rejects(retainScalarDefinitions(materials,limited,fn=>fn()),{code:'DATASET_CALCULATION_RESOURCE'});
 const controller=new AbortController();controller.abort();await assert.rejects(retainScalarDefinitions(materials,unit(),fn=>fn(),{signal:controller.signal}),{name:'AbortError'});
});

test('complete selected scalar operands verify their retained text digest before numeric interpretation',async()=>{
 const {resolveScalarOperand}=await import('../src/measurement-scalar-storage.js'),{retainDatasetCell}=await import('../src/dataset-cell-storage.js'),{materials}=fixture(),p=policy(),spelling='0'.repeat(9000)+'1',cell=await retainDatasetCell(materials,{kind:'string',value:spelling},fn=>fn()),column={representation:'integer',radix:10,missing:[],resourcePolicy:p};
 assert.equal((await resolveScalarOperand(materials,cell,column,{policy:p})).value,spelling);const wrong={...cell,value:{...cell.value,sha256:'0'.repeat(64)}};
 await assert.rejects(resolveScalarOperand(materials,wrong,column,{policy:p}),{code:'MATERIAL_MISSING'});assert.deepEqual(cell.value.sha256,(await retainDatasetCell(materials,{kind:'string',value:spelling},fn=>fn())).value.sha256);
});
