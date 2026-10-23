import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validClockDefinition,clockModulusIdentity,clockRateIdentity} from '../src/web/measurement-clock-model.js';
import {blankClock,validTime,schemaReferences} from '../src/web/measurement-model.js';
import {exactUnitScalar,blankUnitDefinition} from '../src/web/measurement-unit-model.js';
const scalar=exactUnitScalar;
const rate=(counts=scalar('1'),interval=scalar('1'),unit='custom interval')=>({version:1,modulus:null,rate:{counts,interval,unit}});
test('declared clock modulus preserves a native numeral context without inferring hardware width',()=>{
 const value={version:1,modulus:scalar('100000','radix',6),rate:null},original=structuredClone(value);assert.equal(validClockDefinition(value),true);assert.equal(clockModulusIdentity(value),'7776');assert.equal(clockRateIdentity(value),null);assert.deepEqual(value,original);
 assert.equal(clockModulusIdentity({version:1,modulus:scalar('9007199254740993123456789'),rate:null}),'9007199254740993123456789');
 assert.equal(validClockDefinition({...value,width:16}),false);assert.equal(validClockDefinition({version:1,modulus:null,rate:null}),false);assert.equal(validClockDefinition(undefined),false);
 for(const modulus of [scalar('0'),scalar('-1'),scalar('1/2','rational'),scalar('6','radix',6),{spelling:'10',representation:'radix',radix:1}])assert.equal(validClockDefinition({...value,modulus}),false);
});
test('clock rates preserve exact counts, interval spelling and custom unit identity',()=>{
 const value=rate(scalar('15.3','radix-fraction',6),scalar('0.1','radix-fraction',6),'cycle window'),original=structuredClone(value);
 assert.equal(validClockDefinition(value),true);assert.deepEqual(clockRateIdentity(value),{numerator:'69',denominator:'1',unit:'cycle window',canonical:false});assert.equal(clockModulusIdentity(value),null);assert.deepEqual(value,original);
 assert.deepEqual(clockRateIdentity(rate(scalar('1/7','rational'),scalar('3/11','rational'),'')),{numerator:'11',denominator:'21',unit:'',canonical:false});
 assert.throws(()=>clockRateIdentity(value,{canonical:true}),/declared interval/);assert.throws(()=>clockRateIdentity(value,{canonical:'false'}),/context/);
});
test('optional typed rate intervals must be differences and canonicalization is explicit',()=>{
 const unitDefinition={...blankUnitDefinition(),dimensions:[{axis:'custom.interval',exponent:1}],scale:scalar('0.1','radix-fraction',6)},value=rate(scalar('0.1','radix-fraction',6),scalar('0.1','radix-fraction',6),'native interval');value.rate.unitDefinition=unitDefinition;
 assert.equal(validClockDefinition(value),true);assert.equal(clockRateIdentity(value).numerator,'1');const canonical=clockRateIdentity(value,{canonical:true});assert.equal(canonical.numerator,'6');assert.equal(canonical.denominator,'1');assert.equal(canonical.canonical,true);assert.equal(canonical.unit,null);assert.equal(canonical.sourceUnit,'native interval');canonical.intervalDimensions[0].axis='changed';assert.equal(value.rate.unitDefinition.dimensions[0].axis,'custom.interval');
 assert.equal(validClockDefinition({...value,rate:{...value.rate,unitDefinition:{...unitDefinition,kind:'absolute'}}}),false);assert.equal(validClockDefinition({...value,rate:{...value.rate,unitDefinition:{...unitDefinition,offset:scalar('1')}}}),false);
});
test('invalid rates and undeclared extra semantics are refused instead of guessed',()=>{
 const value=rate();for(const invalid of [null,{...value,version:2},{...value,rate:{...value.rate,counts:scalar('0')}},{...value,rate:{...value.rate,interval:scalar('-1')}},{...value,rate:{...value.rate,counts:scalar('NaN','decimal')}},{...value,rate:{...value.rate,unit:'x'.repeat(101)}},{...value,rate:{...value.rate,unit:'seconds\n'}},{...value,rate:{...value.rate,frequency:1000}},{...value,epoch:'host time'}])assert.equal(validClockDefinition(invalid),false);
 assert.throws(()=>clockModulusIdentity({version:1,modulus:scalar('0'),rate:null}),/Invalid/);assert.throws(()=>clockRateIdentity({...value,rate:null}),/Invalid/);
});

test('clock definitions preserve old time meanings, independent hardware facts and pinned references',()=>{
 const definition=rate(scalar('15.3','radix-fraction',6),scalar('0.1','radix-fraction',6),'native window'),ref={kind:'artifact',id:'3eec8b92-bef5-44b5-a04a-9fa22d617978',revision:'a'.repeat(64)};
 for(const kind of ['none','unknown','acquisition-order','counter','wall-clock','elapsed','powered-duration','inferred-elapsed']){
  const old={kind,reference:'',resolution:'',uncertainty:'',clock:{...blankClock(),width:8,frequency:'1000',wrap:'observed',reset:'observed'}};
  assert.equal(validTime(old),true);assert.equal(validTime({...old,clock:{...old.clock,definition}}),true);assert.equal(old.clock.definition,undefined);
 }
 const time={kind:'external',reference:'Declared scale',resolution:'',uncertainty:'',clock:{...blankClock(),definition,model:ref,referenceData:ref}};assert.equal(validTime(time),true);assert.deepEqual(schemaReferences({time}),[ref,ref]);assert.equal(validTime({...time,clock:{...time.clock,model:null}}),false);assert.equal(validTime({...time,clock:{...time.clock,definition:{...definition,version:2}}}),false);
});
