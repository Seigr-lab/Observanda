import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankIntervalUncertainty,enclosureUncertainty,validIntervalUncertainty,validIntervalCoverage,intervalReferences,intervalDomain,validIntervalDomain} from '../src/web/measurement-interval-model.js';
import {parseIntervalBounds,calculateIntervalBounds,convertIntervalBounds,intervalComponents} from '../src/measurement-interval.js';
import {ArithmeticBudget} from '../src/tools/exact-arithmetic.js';
import {exactUnitScalar} from '../src/web/measurement-unit-model.js';
const context={version:1,representation:'decimal',radix:10};
const interval=(lower,upper=lower,format=context)=>parseIntervalBounds([lower,upper],format);
const method=()=>({...blankIntervalUncertainty(),method:{name:'Declared instrument bounds',version:'revision A',reference:{kind:'artifact',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64),label:'Instrument method'}}});
const unit=(kind,axis,scale='1',offset='0')=>({version:1,kind,dimensions:axis?[{axis,exponent:1}]:[],scale:exactUnitScalar(scale),offset:exactUnitScalar(offset,'decimal')});

test('interval declarations preserve exact authored coverage and pinned methods without inventing statistical claims',()=>{
 const authored=method();authored.coverage={kind:'confidence',level:exactUnitScalar('0.2','radix-fraction',6)};
 assert.equal(validIntervalUncertainty(authored),true);assert.deepEqual(intervalReferences(authored),[authored.method.reference]);assert.equal(authored.coverage.level.spelling,'0.2');
 assert.equal(validIntervalUncertainty(blankIntervalUncertainty()),false);assert.equal(validIntervalUncertainty({...authored,coverage:null}),true);
 for(const level of ['0','1','1/3'])assert.equal(validIntervalCoverage({kind:'probability',level:exactUnitScalar(level,level.includes('/')?'rational':'integer')}),true);
 for(const level of ['-0.1','1.01'])assert.equal(validIntervalCoverage({kind:'confidence',level:exactUnitScalar(level,'decimal')}),false);
 assert.equal(validIntervalCoverage({kind:'confidence',level:0.95}),false);assert.equal(validIntervalCoverage({kind:'confidence',level:exactUnitScalar('0.2','decimal',6)}),false);
 assert.equal(validIntervalUncertainty({...authored,covariance:0}),false);assert.equal(validIntervalUncertainty({...authored,distribution:'normal'}),false);
 assert.equal(validIntervalUncertainty({...authored,method:{...authored.method,reference:{...authored.method.reference,revision:'latest'}}}),false);
 const derived=enclosureUncertainty();assert.equal(validIntervalUncertainty(derived),true);assert.equal(derived.coverage,null);assert.deepEqual(intervalReferences(derived),[]);
 assert.equal(validIntervalUncertainty({...derived,coverage:authored.coverage}),false);assert.equal(validIntervalUncertainty({...derived,method:{...derived.method,version:'2'}}),false);
 assert.equal(validIntervalUncertainty(authored),true,'Producing an enclosure must not rewrite the retained input claim');
});

test('closed interval endpoints retain adjacent large values and exact nondecimal fractions',()=>{
 assert.equal(validIntervalDomain(intervalDomain()),true);assert.equal(validIntervalDomain({...intervalDomain(),shape:[2,1]}),false);assert.equal(validIntervalDomain({...intervalDomain(),codecVersion:2}),false);
 const left='1000000000000000000000000000000',right='1000000000000000000000000000001';
 assert.deepEqual(intervalComponents(interval(left,right)),[left+'/1',right+'/1']);
 assert.deepEqual(intervalComponents(interval('0.2','0.3',{version:1,representation:'radix-fraction',radix:6})),['1/3','1/2']);
 assert.deepEqual(intervalComponents(interval('-2/6','0/1',{version:1,representation:'rational',radix:10})),['-1/3','0/1']);
 assert.throws(()=>interval('2','1'),/lower interval bound/);
 assert.throws(()=>parseIntervalBounds([null,'1'],context),/scalar interval bounds/);
 assert.throws(()=>parseIntervalBounds([{format:'dataset-cell',preview:'1'},'2'],context),/scalar interval bounds/);
 assert.throws(()=>parseIntervalBounds(['0','1'],{...context,radix:6}),/numeral context/);
});

test('interval enclosure arithmetic is exact and does not assume independence or repeated-input correlation',()=>{
 const a=interval('1/3','2/3',{version:1,representation:'rational',radix:10}),b=interval('1/6','1/2',{version:1,representation:'rational',radix:10});
 assert.deepEqual(intervalComponents(calculateIntervalBounds('add',a,b)),['1/2','7/6']);
 assert.deepEqual(intervalComponents(calculateIntervalBounds('subtract',a,b)),['-1/6','1/2']);
 const mixed=interval('-2','3');assert.deepEqual(intervalComponents(calculateIntervalBounds('multiply',mixed,interval('4','5'))),['-10/1','15/1']);
 assert.deepEqual(intervalComponents(calculateIntervalBounds('divide',mixed,interval('4','5'))),['-1/2','3/4']);
 assert.deepEqual(intervalComponents(calculateIntervalBounds('divide',mixed,interval('-5','-4'))),['-3/4','1/2']);
 assert.deepEqual(intervalComponents(calculateIntervalBounds('subtract',mixed,mixed)),['-5/1','5/1']);
 for(const divisor of [interval('-1','1'),interval('0','1'),interval('-1','0'),interval('0')])assert.throws(()=>calculateIntervalBounds('divide',mixed,divisor),/containing zero/);
 assert.throws(()=>calculateIntervalBounds('mean',mixed,mixed),/Unsupported/);
 assert.deepEqual(intervalComponents(mixed),['-2/1','3/1']);
});

test('interval conversions and arithmetic preserve absolute and difference unit semantics',()=>{
 const celsius=unit('absolute','temperature','1','273.15'),kelvin=unit('absolute','temperature'),difference=unit('difference','temperature');
 assert.deepEqual(intervalComponents(convertIntervalBounds(interval('0','100'),celsius,kelvin)),['5463/20','7463/20']);
 assert.deepEqual(intervalComponents(calculateIntervalBounds('subtract',interval('20','21'),interval('10','11'),{leftUnit:celsius,rightUnit:celsius,outputUnit:difference})),['9/1','11/1']);
 assert.deepEqual(intervalComponents(calculateIntervalBounds('add',interval('20','21'),interval('1','2'),{leftUnit:celsius,rightUnit:difference,outputUnit:celsius})),['21/1','23/1']);
 assert.throws(()=>calculateIntervalBounds('add',interval('1'),interval('2'),{leftUnit:celsius,rightUnit:celsius,outputUnit:celsius}),/absolute quantity/);
 assert.throws(()=>calculateIntervalBounds('multiply',interval('1'),interval('2'),{leftUnit:celsius,rightUnit:difference,outputUnit:difference}),/Absolute quantities/);
 assert.throws(()=>convertIntervalBounds(interval('1'),celsius,difference),/quantity kinds/);
 assert.throws(()=>convertIntervalBounds(interval('1'),difference,unit('difference','length')),/dimensions/);
 assert.throws(()=>calculateIntervalBounds('add',interval('1'),interval('2'),{leftUnit:difference}),/cannot be mixed/);
 const metres=unit('difference','length'),centimetres=unit('difference','length','0.01');centimetres.scale=exactUnitScalar('0.01','decimal');
 assert.deepEqual(intervalComponents(convertIntervalBounds(interval('1','2'),metres,centimetres)),['100/1','200/1']);
});

test('interval resource and retained-component limits refuse instead of rounding or storing unreadable results',()=>{
 assert.throws(()=>parseIntervalBounds(['1e100','1e101'],context,{budget:new ArithmeticBudget({maxBits:64})}),/resource budget/);
 assert.throws(()=>calculateIntervalBounds('add',interval('1'),interval('2'),{budget:new ArithmeticBudget({maxOperations:1})}),/resource budget/);
 const expired=new ArithmeticBudget();expired.deadline=0;assert.throws(()=>intervalComponents(interval('1'),{budget:expired}),/resource budget/);
 const edge=interval('1e8189');assert.equal(intervalComponents(edge)[0].length,8192);
 assert.throws(()=>intervalComponents(interval('1e8190')),/retained scalar capacity/);
 assert.deepEqual(intervalComponents(interval('1e-1000')),[`1/${'1'+'0'.repeat(1000)}`,`1/${'1'+'0'.repeat(1000)}`]);
});
