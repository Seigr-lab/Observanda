import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {calculateExactStep,exactCalculationCondition,exactCalculationKey,validateExactStep,validateExactCondition} from '../src/dataset-exact-calculation.js';
import {ArithmeticBudget} from '../src/tools/exact-arithmetic.js';
import {validCalculation,validCondition,validOperand,calculateStep} from '../src/web/dataset-calculation-model.js';
import {DatasetCalculations,calculationReferences,verifyRetainedCalculation} from '../src/dataset-calculations.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
const constant=(constant,unit='',extra={})=>({constant,unit,...extra}),step=(operation,left,right=null,extra={})=>({name:'Result',operation,left,right,unit:'',condition:null,...extra}),comparison=(left,operator,right)=>({left,operator,right});
const ref=()=>({kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)});
const recipe=()=>({version:3,source:ref(),projection:[0],view:'observations',joins:[],steps:[],where:null,selectionReason:'',calibration:null,note:''});
const unit=(scale='1',kind='difference',offset='0',dimensions=[{axis:'length',exponent:1}])=>({...blankUnitDefinition(),kind,dimensions,scale:exactUnitScalar(scale,scale.includes('/')?'rational':'integer'),offset:exactUnitScalar(offset,offset.includes('/')?'rational':'integer')});
const quantity=unitDefinition=>({origin:'derived',conversion:null,calibration:null,unitDefinition});
const scalar=(value,definition)=>constant(value,'',{quantity:quantity(definition)});
const evaluate=(operation,a,b=null,extra={})=>calculateExactStep(step(operation,constant(a),b===null?null:constant(b),extra),{cells:[]},[]).value;
test('v3 exact quotient, signed remainder, authored rounding and integer powers never round implicitly',()=>{
 for(const [a,b,q,r] of [['-7','3','-2/1','-1/1'],['7','-3','-2/1','1/1'],['-7','-3','2/1','-1/1'],['2.5','0.75','3/1','1/4']]){assert.equal(evaluate('quotient',a,b),q);assert.equal(evaluate('remainder',a,b),r);}
 assert.equal(evaluate('floor','-1.5'),'-2/1');assert.equal(evaluate('ceiling','-1.5'),'-1/1');assert.equal(evaluate('power','2','-3'),'1/8');assert.equal(evaluate('power','-2','3'),'-8/1');assert.equal(evaluate('power','0','0'),'1/1');
 assert.throws(()=>evaluate('power','2','0.5'),/integer exponent/);assert.throws(()=>evaluate('power','0','-1'),/zero/);assert.throws(()=>evaluate('quotient','1','0'),/zero/);
 assert.equal(evaluate('power','2','3',{output:{version:1,representation:'radix',radix:6}}),'12');
 assert.throws(()=>evaluate('power','3','-1',{output:{version:1,representation:'decimal',radix:10}}),{code:'NUMERAL_RESULT_INEXACT'});
 assert.throws(()=>calculateExactStep(step('power',constant('2'),constant('1000')),{cells:[]},[],new ArithmeticBudget({maxBits:64})),/resource budget/);
 assert.throws(()=>evaluate('power','2','100000'),/resource budget/);
});
test('nested conditions use three-valued logic and keep all original cell provenance',()=>{
 const refValue=ref(),columns=[{...defaultColumn({label:'Value'}),representation:'integer'},defaultColumn({label:'Missing'})],row={cells:['9007199254740993',''],valueKinds:['string','absent'],cellSources:[[{ref:refValue,selector:{kind:'cell',page:7,row:3,column:99}}],[]]},yes=comparison({column:0},'gt',constant('9007199254740992')),unknown=comparison({column:1},'eq',constant('x')),no=comparison(constant('1'),'eq',constant('0'));
 for(const [condition,expected] of [[{operator:'and',conditions:[unknown,no]},false],[{operator:'or',conditions:[unknown,yes]},true],[{operator:'not',condition:unknown},null],[{operator:'and',conditions:[yes,unknown]},null]])assert.equal(exactCalculationCondition(condition,row,columns),expected);
 const choice=step('choose',{column:0},constant('0'),{condition:{operator:'or',conditions:[unknown,yes]}}),result=calculateExactStep(choice,row,columns);assert.equal(result.value,'9007199254740993/1');assert.deepEqual(result.sources,row.cellSources[0]);assert.equal(calculateExactStep({...choice,condition:unknown},row,columns).kind,'absent');
 const v=recipe();v.steps=[choice];assert.equal(validCalculation(v),true);assert.equal(validCalculation({...v,version:2}),false);
 let deep=yes;for(let i=0;i<9;i++)deep={operator:'not',condition:deep};assert.equal(validCondition(deep,2,3),false);
 assert.equal(validCondition({operator:'and',conditions:[yes]},2,3),false);assert.equal(validCondition({operator:'or',conditions:Array(17).fill(yes)},2,3),false);
});
test('declared affine units convert exactly and reject dimensional or untyped substitutions',()=>{
 const cm=unit('1/100'),m=unit('1/1'),absolute=unit('1/1','absolute','27315/100',[{axis:'temperature',exponent:1}]),kelvin=unit('1/1','absolute','0/1',[{axis:'temperature',exponent:1}]),difference=unit('1/1','difference','0/1',[{axis:'temperature',exponent:1}]);
 const run=(operation,a,b,out)=>calculateExactStep(step(operation,a,b,{quantity:quantity(out)}),{cells:[]},[]).value;
 assert.equal(run('add',scalar('100',cm),scalar('2',m),m),'3/1');assert.equal(run('copy',scalar('1.5',cm),null,m),'3/200');assert.equal(run('floor',scalar('1.5',cm),null,cm),'1/1');assert.throws(()=>run('floor',scalar('1.5',cm),null,m),/authored unit/);
 assert.equal(run('subtract',scalar('20',absolute),scalar('283.15',kelvin),difference),'10/1');assert.equal(run('add',scalar('20',absolute),scalar('10',difference),absolute),'30/1');assert.throws(()=>run('add',scalar('20',absolute),scalar('10',absolute),absolute),/absolute/);
 assert.equal(run('quotient',scalar('250',cm),scalar('1',m),unit('1/1','difference','0/1',[])),'2/1');assert.equal(run('remainder',scalar('250',cm),scalar('1',m),cm),'50/1');
 assert.equal(run('power',scalar('2',m),scalar('2',unit('1/1','difference','0/1',[])),unit('1/1','difference','0/1',[{axis:'length',exponent:2}])),'4/1');
 assert.throws(()=>run('add',scalar('1',m),constant('2'),m),/undeclared/);assert.throws(()=>run('multiply',scalar('1',absolute),scalar('2',difference),absolute),/Absolute/);
 assert.equal(exactCalculationCondition(comparison(scalar('100',cm),'eq',scalar('1',m)),{cells:[]},[]),true);
});
test('historical recipes remain historical while v3 pins exact contexts and retained unit references',async()=>{
 const c=recipe(),calibration=ref(),conversion=ref(),operand=constant('10','',{representation:'radix',radix:6,quantity:{...quantity(unit('1/1')),calibration,conversion}});c.steps=[step('floor',operand,null,{quantity:quantity(unit('1/1'))})];assert.equal(validCalculation(c),true);assert.equal(validOperand(operand,1,2),false);assert.equal(validCalculation({...c,version:2}),false);assert.equal(validCalculation({...c,version:4}),false);
 assert.deepEqual(calculationReferences(c),[c.source,conversion,calibration]);const doc={content:{calculation:c,algorithm:'observanda-retained-calculations',algorithmVersion:2}},materials={async read(){return {content:{schemaIndex:{count:1}}};},async datasetColumn(){return {...defaultColumn({label:'Source'}),representation:'integer'};},async *references(){yield* calculationReferences(c);}};await verifyRetainedCalculation(materials,doc);await assert.rejects(verifyRetainedCalculation(materials,{content:{...doc.content,algorithmVersion:1}}),{code:'CATALOGUE_DAMAGED'});await assert.rejects(verifyRetainedCalculation({async *references(){yield c.source;}},doc),{code:'CATALOGUE_DAMAGED'});
 const old=step('add',constant('0.1'),constant('0.2'));assert.equal(calculateStep(old,{cells:[]},[]).value,'3/10');const v2={...recipe(),version:2,steps:[old]};assert.equal(validCalculation(v2),true);const {projection,...v1}=v2;v1.version=1;assert.equal(validCalculation(v1),true);
});

test('declared quantity admission checks every branch and empty-data schema, while v3 join keys convert exactly',()=>{
 const length=unit('1/1'),time=unit('1/1','difference','0/1',[{axis:'time',exponent:1}]),columns=[{...defaultColumn({label:'Length'}),representation:'integer',quantity:quantity(length)},{...defaultColumn({label:'Time'}),representation:'integer',quantity:quantity(time)}];
 assert.throws(()=>validateExactStep(step('add',{column:0},{column:1},{quantity:quantity(length)}),columns),/dimension/);assert.throws(()=>validateExactCondition({operator:'or',conditions:[comparison(constant('1'),'eq',constant('1')),comparison({column:0},'eq',{column:1})]},columns),/dimension/);
 assert.deepEqual(exactCalculationKey('100',{...columns[0],quantity:quantity(unit('1/100'))}),exactCalculationKey('1',columns[0]));assert.notDeepEqual(exactCalculationKey('1',columns[0]),exactCalculationKey('1',columns[1]));
});

test('v3 conditions distinguish numeric values from explicit symbols and rounding accepts equivalent exact unit scalars',()=>{
 const numeric=constant('1'),symbol=constant('1','',{representation:'text',radix:10});assert.throws(()=>exactCalculationCondition(comparison(numeric,'eq',symbol),{cells:[]},[]),/numeric/);assert.throws(()=>validateExactCondition(comparison(numeric,'eq',symbol),[]),/distinct/);assert.equal(exactCalculationCondition(comparison(symbol,'eq',symbol),{cells:[]},[]),true);
 const original=unit('1/100'),equivalent={...original,scale:exactUnitScalar('0.01','decimal')};assert.equal(calculateExactStep(step('floor',scalar('1.5',original),null,{quantity:quantity(equivalent)}),{cells:[]},[]).value,'1/1');
});

test('v3 comparison-derived values preserve a common declared definition and reject unnormalized mixtures',async()=>{
 const a=ref(),b=ref(),analysis={...ref(),kind:'analysis'},definition=unit('1/100'),columns=[{...defaultColumn({label:'Value'}),unit:'cm',representation:'integer',quantity:quantity(definition)},{...defaultColumn({label:'Value'}),unit:'cm',representation:'integer',quantity:quantity({...definition,scale:exactUnitScalar('0.01','decimal')})}],materials={async read(ref){return ref.id===analysis.id?{content:{comparison:{sources:[a,b].map(dataset=>({dataset,columns:{value:0}}))}}}:{id:ref.id};},async datasetColumn(doc){return columns[doc.id===a.id?0:1];}},service=new DatasetCalculations(materials);
 assert.deepEqual((await service.schema(analysis,'observations',{columns:[0],version:3}))[0].quantity.unitDefinition,definition);assert.equal((await service.schema(analysis,'observations',{columns:[0],version:2}))[0].quantity?.unitDefinition,undefined);
 columns[1].quantity=quantity(unit('1/1'));await assert.rejects(service.schema(analysis,'distribution',{columns:[0],version:3}),{code:'DATASET_CALCULATION'});columns[1].quantity={origin:'derived',conversion:null,calibration:null};await assert.rejects(service.schema(analysis,'observations',{columns:[0],version:3}),{code:'DATASET_CALCULATION'});
});
