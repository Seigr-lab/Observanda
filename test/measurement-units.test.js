import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankQuantity,validQuantity,exactRational,schemaReferences} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar,validUnitDefinition,sameUnitDefinition,canonicalUnitValue,fromCanonicalUnitValue,convertUnitValue,unitOperationDimensions,assertUnitOperation} from '../src/web/measurement-unit-model.js';
const scalar=exactUnitScalar;
const unit=(axis='length',extra={})=>({...blankUnitDefinition(),dimensions:axis?[{axis,exponent:1}]:[],...extra});
const rational=(n,d=1n)=>({numerator:n,denominator:d});
test('unit declarations are optional and never inferred from labels or raw-code quantities',()=>{
 assert.equal(validQuantity(blankQuantity(),'arbitrary label'),true);assert.equal(validQuantity({...blankQuantity(),unitDefinition:unit()},'unrelated label'),true);
 assert.equal(validQuantity({...blankQuantity(),origin:'raw-code'},''),true);assert.equal(validQuantity({...blankQuantity(),origin:'raw-code',unitDefinition:unit('custom.instrument')},''),false);
 assert.equal(validUnitDefinition(unit('custom.instrument')),true);assert.equal(validUnitDefinition(unit('')),true);
 for(const invalid of [{...unit(),scale:scalar('0')},{...unit(),scale:scalar('-1')},{...unit(),offset:scalar('1')},{...unit(),scale:{spelling:'0.1',representation:'radix-fraction',radix:1}},{...unit(),scale:scalar('NaN','decimal')},{...unit(),dimensions:[{axis:'length',exponent:0}]},{...unit(),dimensions:[{axis:'x',exponent:1},{axis:'x',exponent:2}]},{...unit(),dimensions:[{axis:'z',exponent:1},{axis:'a',exponent:1}]},{...unit(),version:2},{...unit(),kind:'guessed'}])assert.equal(validUnitDefinition(invalid),false,JSON.stringify(invalid));
});
test('exact affine conversion preserves original base-six scale and offset spellings',()=>{
 const source=unit('temperature',{kind:'absolute',scale:scalar('0.1','radix-fraction',6),offset:scalar('15.3','radix-fraction',6)}),destination=unit('temperature',{kind:'absolute',scale:scalar('1/3','rational'),offset:scalar('-1/2','rational')}),before=structuredClone(source);
 assert.deepEqual(canonicalUnitValue(exactRational('15.3','radix-fraction',6),source),rational(161n,12n));
 assert.deepEqual(convertUnitValue(rational(23n,2n),source,destination),rational(167n,4n));
 assert.deepEqual(fromCanonicalUnitValue(rational(161n,12n),source),rational(23n,2n));assert.deepEqual(source,before);
 assert.throws(()=>convertUnitValue(rational(1n),source,unit('temperature')),/Incompatible/);assert.throws(()=>convertUnitValue(rational(1n),source,unit('custom.temperature',{kind:'absolute'})),/Incompatible/);
});
test('absolute and difference arithmetic is explicit and dimension algebra stays exact',()=>{
 const absolute=unit('temperature',{kind:'absolute',offset:scalar('273.15','decimal')}),delta=unit('temperature');
 assert.deepEqual(unitOperationDimensions('subtract',absolute,absolute),{kind:'difference',dimensions:delta.dimensions});assert.equal(unitOperationDimensions('add',absolute,delta).kind,'absolute');assert.equal(unitOperationDimensions('add',delta,absolute).kind,'absolute');assert.equal(unitOperationDimensions('subtract',absolute,delta).kind,'absolute');
 assert.throws(()=>unitOperationDimensions('add',absolute,absolute));assert.throws(()=>unitOperationDimensions('subtract',delta,absolute));assert.throws(()=>unitOperationDimensions('multiply',absolute,delta));
 const speed=unitOperationDimensions('divide',unit('length'),unit('time'));assert.deepEqual(speed.dimensions,[{axis:'length',exponent:1},{axis:'time',exponent:-1}]);
 assert.deepEqual(unitOperationDimensions('multiply',unit('length'),unit('length')).dimensions,[{axis:'length',exponent:2}]);assert.deepEqual(unitOperationDimensions('divide',unit('length'),unit('length')).dimensions,[]);
 assert.throws(()=>assertUnitOperation('multiply',unit('length'),unit('time'),unit('length')));assert.throws(()=>unitOperationDimensions('add',unit('length'),unit('time')));
});
test('quotient, remainder and power retain their declared dimensional contract',()=>{
 const length=unit('length'),dimensionless=unit('');assert.deepEqual(unitOperationDimensions('quotient',length,length).dimensions,[]);assert.deepEqual(unitOperationDimensions('remainder',length,length).dimensions,length.dimensions);
 assert.deepEqual(unitOperationDimensions('power',length,dimensionless,rational(-2n)).dimensions,[{axis:'length',exponent:-2}]);assert.deepEqual(unitOperationDimensions('power',length,dimensionless,rational(0n)).dimensions,[]);
 assert.throws(()=>unitOperationDimensions('power',length,unit('time'),rational(2n)));assert.throws(()=>unitOperationDimensions('power',length,dimensionless,rational(1n,2n)));assert.throws(()=>unitOperationDimensions('power',length,dimensionless,rational(33n)));
 assert.throws(()=>unitOperationDimensions('multiply',unit('length',{dimensions:[{axis:'length',exponent:32}]}),length));
});
test('conversion and calibration references remain independently pinned optional provenance',()=>{
 const reference={kind:'artifact',id:'00000000-0000-4000-8000-000000000001',revision:'a'.repeat(64)},quantity={...blankQuantity(),unitDefinition:unit('voltage',{scale:scalar('1/100','rational')})};
 assert.equal(validQuantity(quantity,'V'),true);assert.deepEqual(schemaReferences({quantity}),[]);quantity.conversion=reference;quantity.calibration={...reference,revision:'b'.repeat(64)};assert.equal(validQuantity(quantity,'V'),true);assert.deepEqual(schemaReferences({quantity}),[quantity.conversion,quantity.calibration]);assert.equal(validQuantity({...quantity,calibration:{...reference,revision:'current'}},'V'),false);
});
test('large source values and recurring scale fractions never pass through binary floating point',()=>{
 const source=unit('custom.count',{scale:scalar('0.1','radix-fraction',6)}),n=900719925474099312345678901234567890n;
 assert.deepEqual(canonicalUnitValue(rational(n),source),rational(n/6n));assert.deepEqual(convertUnitValue(rational(n),source,unit('custom.count',{scale:scalar('1/3','rational')})),rational(n/2n));
 assert.deepEqual(exactRational('0.1','radix-fraction',6),rational(1n,6n));
});

test('dimensionless powers follow the arithmetic budget while dimension exponents remain bounded',()=>{
 const dimensionless=unit('');for(const exponent of [100n,-100n,9007199254740993n])assert.deepEqual(unitOperationDimensions('power',dimensionless,dimensionless,rational(exponent)).dimensions,[]);
 assert.throws(()=>unitOperationDimensions('power',unit('length'),dimensionless,rational(9007199254740993n)),/dimension exponent/);
 assert.equal(sameUnitDefinition(unit('length',{scale:scalar('0.1','radix-fraction',6)}),unit('length',{scale:scalar('1/6','rational')})),true);
 assert.equal(sameUnitDefinition(unit('length'),unit('length',{kind:'absolute'})),false);
 const spelling='0.'+'0'.repeat(8189)+'1';assert.equal(spelling.length,8192);assert.equal(validUnitDefinition(unit('custom.count',{scale:scalar(spelling,'decimal')})),true);assert.equal(validUnitDefinition(unit('custom.count',{scale:scalar(spelling+'0','decimal')})),false);
});
