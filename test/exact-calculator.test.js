import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,calculateDetailed,convertBase,spreadsheet} from '../src/tools/math.js';
import {ArithmeticBudget,parseExact,exactRadixText} from '../src/tools/exact-arithmetic.js';
import {validateTool} from '../src/modules/tools.js';

test('exact calculator retains rational arithmetic, large cancellation and exact sample statistics',()=>{
 for(const [expression,value] of [['1/3','1/3'],['(1/3)*3','1'],['1e100+1-1e100','1'],['(10^100+1)/3*3-10^100','1'],['quotient(-7,3)','-2'],['remainder(-7,3)','-1'],['-7 mod 3','2'],['floor(-1/3)','-1'],['ceil(-1/3)','0'],['round(-1.5)','-2'],['2^-3','0.125'],['mean(1/3,2/3)','0.5'],['variance(1/3,2/3)','1/18'],['sqrt(4/9)','2/3'],['cbrt(-8/27)','-2/3']])assert.equal(calculate(expression),value,expression);
 const long='0.'+'1234567890'.repeat(8)+'1';assert.equal(calculate(long),long);assert.equal(calculate('('+long+')+1'),'1.'+long.slice(2));
 assert.equal(spreadsheet([[long,'=A1+1']])[0][1].value,'1.'+long.slice(2));
 assert.throws(()=>calculate('sin'),/scalar/);
 assert.deepEqual(calculateDetailed('1/3').exact,{numerator:'1',denominator:'3'});
 assert.deepEqual(calculateDetailed('sqrt(2)').approximation,{workingDigits:64,displayDigits:32});
 assert.ok(calculateDetailed('25 degC to degF').approximation);
 assert.throws(()=>calculate('10^10000000'),/resource budget/);
 assert.throws(()=>calculate('1/0'),/zero/);
});
test('spreadsheet uses typed values across dependencies rather than rounded display strings',()=>{
 const result=spreadsheet([['=1/3','=A1*3'],['=1e100+1','=A2-1e100'],['=sqrt(2)','=B3*0+A3'],["'0042",'=A4+1'],['=B5','=A5']]);
 assert.equal(result[0][0].value,'1/3');assert.equal(result[0][1].value,'1');assert.equal(result[1][1].value,'1');
 assert.ok(result[2][0].approximation);assert.match(result[2][1].error,/Circular/);assert.match(result[3][1].error,/not numeric/);assert.match(result[4][0].error,/Circular/);
 const chain=spreadsheet([['=sqrt(2)','=A1*A1','=B1-2']]);assert.ok(chain[0][1].approximation);assert.equal(chain[0][2].value,'0');
});
test('fractional base conversion preserves exact values and recurring ratios in each radix',()=>{
 assert.equal(convertBase('0.2',6,10),'1/3');assert.equal(convertBase('1/3',10,6),'0.2');assert.equal(convertBase('0.1',10,6),'1/14');
 assert.equal(convertBase('1/14',6,10),'0.1');assert.equal(convertBase('-10.3',6,10),'-6.5');assert.equal(convertBase('0.101',2,16),'0.a');
 assert.equal(convertBase(convertBase('123456789012345678901234567890.125',10,6),6,10),'123456789012345678901234567890.125');
 assert.throws(()=>convertBase('0.6',6,10));assert.throws(()=>convertBase('1/0',6,10));
});
test('engine versions preserve historical decimal results and validate saved exact worksheets',()=>{
 assert.equal(calculate('1/3',{engine:1}),'0.33333333333333333333333333333333');
 assert.notEqual(spreadsheet([['=1/3','=A1*3']],{engine:1})[0][1].value,'1');
 assert.equal(spreadsheet([['1e100000']],{engine:1})[0][0].value,'1e100000');
 assert.throws(()=>calculate('1',{engine:3}),/Unsupported/);
 const data={name:'Exact worksheet',links:[],engine:2,cells:[['=1/3','=A1*3']],original:null};validateTool('sheet',data);assert.throws(()=>validateTool('sheet',{...data,engine:3}));
 assert.equal(exactRadixText(parseExact('0.2'),6),'1/5');
 assert.throws(()=>parseExact('1e100',new ArithmeticBudget({maxBits:64})),/resource budget/);
});
