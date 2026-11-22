import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,calculateDetailed,convertBase,spreadsheet} from '../src/tools/math.js';
import {ArithmeticBudget,parseExact,exactRadixText} from '../src/tools/exact-arithmetic.js';
import {validateTool} from '../src/modules/tools.js';
import {defaultCalculationPolicy} from '../src/web/tools/calculation-policy.js';
const exact=()=>({engine:3,policy:defaultCalculationPolicy()});

test('exact calculator retains rational arithmetic, large cancellation and exact sample statistics',()=>{
 for(const [expression,value] of [['1/3','1/3'],['(1/3)*3','1'],['1e100+1-1e100','1'],['(10^100+1)/3*3-10^100','1'],['quotient(-7,3)','-2'],['remainder(-7,3)','-1'],['-7 mod 3','2'],['floor(-1/3)','-1'],['ceil(-1/3)','0'],['round(-1.5)','-2'],['2^-3','0.125'],['mean(1/3,2/3)','0.5'],['variance(1/3,2/3)','1/18'],['sqrt(4/9)','2/3'],['cbrt(-8/27)','-2/3']])assert.equal(calculate(expression,exact()),value,expression);
 const long='0.'+'1234567890'.repeat(8)+'1';assert.equal(calculate(long,exact()),long);assert.equal(calculate('('+long+')+1',exact()),'1.'+long.slice(2));
 assert.equal(spreadsheet([[long,'=A1+1']],exact())[0][1].value,'1.'+long.slice(2));
 assert.throws(()=>calculate('sin',exact()),/scalar/);
 assert.deepEqual(calculateDetailed('1/3',exact()).exact,{numerator:'1',denominator:'3'});
 assert.deepEqual(calculateDetailed('sqrt(2)',exact()).approximation,{engine:3,...defaultCalculationPolicy()});
 assert.ok(calculateDetailed('25 degC to degF',exact()).approximation);
 assert.throws(()=>calculate('10^10000000',exact()),/resource budget/);
 assert.throws(()=>calculate('1/0',exact()),/zero/);
});
test('spreadsheet uses typed values across dependencies rather than rounded display strings',()=>{
 const result=spreadsheet([['=1/3','=A1*3'],['=1e100+1','=A2-1e100'],['=sqrt(2)','=B3*0+A3'],["'0042",'=A4+1'],['=B5','=A5']],exact());
 assert.equal(result[0][0].value,'1/3');assert.equal(result[0][1].value,'1');assert.equal(result[1][1].value,'1');
 assert.ok(result[2][0].approximation);assert.match(result[2][1].error,/Circular/);assert.match(result[3][1].error,/not numeric/);assert.match(result[4][0].error,/Circular/);
 const chain=spreadsheet([['=sqrt(2)','=A1*A1','=B1-2']],exact());assert.ok(chain[0][1].approximation);assert.equal(chain[0][2].value,'0');
});
test('fractional base conversion preserves exact values and recurring ratios in each radix',()=>{
 const base=(digits,from,to)=>convertBase(digits,from,to,exact());
 assert.equal(base('0.2',6,10),'1/3');assert.equal(base('1/3',10,6),'0.2');assert.equal(base('0.1',10,6),'1/14');
 assert.equal(base('1/14',6,10),'0.1');assert.equal(base('-10.3',6,10),'-6.5');assert.equal(base('0.101',2,16),'0.a');
 assert.equal(base(base('123456789012345678901234567890.125',10,6),6,10),'123456789012345678901234567890.125');
 assert.throws(()=>base('0.6',6,10));assert.throws(()=>base('1/0',6,10));
});
test('only the policy engines calculate and saved worksheets require the policy engine',()=>{
 for(const engine of [undefined,1,2])assert.throws(()=>calculate('1',{engine}),/Unsupported/);
 const data={name:'Exact worksheet',links:[],engine:3,policy:defaultCalculationPolicy(),cells:[['=1/3','=A1*3']],original:null};validateTool('sheet',data);for(const engine of [1,2,4])assert.throws(()=>validateTool('sheet',{...data,engine}));
 assert.equal(exactRadixText(parseExact('0.2'),6),'1/5');
 assert.throws(()=>parseExact('1e100',new ArithmeticBudget({maxBits:64})),/resource budget/);
});
