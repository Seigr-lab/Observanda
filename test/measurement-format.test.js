import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatExactResult,rationalText} from '../src/web/measurement-format.js';
import {exactRational} from '../src/web/measurement-model.js';
import {validNumeralContext} from '../src/web/numeral-context.js';
const context=(representation,radix=10)=>({version:1,representation,radix});
const value=(numerator,denominator=1n)=>({numerator,denominator});

test('result formatting preserves exact identity across supported numeral bases and signs',()=>{
 for(let radix=2;radix<=36;radix++)for(const n of [-9007199254740993n,-7n,-1n,0n,1n,7n,9007199254740993n]){
  const c=context('radix-fraction',radix),fraction=value(n,BigInt(radix)**3n),spelling=formatExactResult(fraction,c);
  assert.deepEqual(exactRational(spelling,c.representation,radix),exactRational(rationalText(fraction),'rational'));
  const integer=formatExactResult(value(n),context('radix',radix));assert.deepEqual(exactRational(integer,'radix',radix),value(n));
 }
 assert.equal(formatExactResult(value(1n,3n),context('radix-fraction',6)),'0.2');
 assert.equal(formatExactResult(value(-7n,12n),context('radix-fraction',6)),'-0.33');
 assert.equal(formatExactResult(value(1n,8n),context('decimal')),'0.125');
 assert.equal(formatExactResult(value(0n,-9n),context('decimal')),'0');
 assert.equal(formatExactResult(value(2n,-6n)),'-1/3');
});

test('nonterminating, noninteger and oversized outputs refuse without rounding',()=>{
 for(const [v,c] of [[value(1n,3n),context('decimal')],[value(1n,5n),context('radix-fraction',6)],[value(-1n,2n),context('radix',6)],[value(1n,6n),context('integer')]])assert.throws(()=>formatExactResult(v,c),{code:'NUMERAL_RESULT_INEXACT'});
 assert.throws(()=>formatExactResult(value(10n**8192n),context('integer')),{code:'NUMERAL_RESULT_CAPACITY'});
 assert.throws(()=>formatExactResult(value(1n,2n**8192n),context('radix-fraction',2)),{code:'NUMERAL_RESULT_CAPACITY'});
 assert.equal(formatExactResult(value(10n**8190n),context('integer')).length,8191);
 assert.throws(()=>formatExactResult(value(1n,0n)),/division/);
 for(const c of [{version:2,representation:'radix',radix:6},context('decimal',6),context('radix',1),context('radix',37),context('text'),{...context('rational'),round:true}])assert.equal(!!validNumeralContext(c),false);
});
