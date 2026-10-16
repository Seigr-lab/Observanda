import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,calculationPreview,convertBase} from '../src/tools/math.js';
import {editExpression,statisticExpression,normalizeSymbols,validWorksheet,nextArgument} from '../src/web/tools/calculator-model.js';
test('calculator controls edit the selection or preceding operand while retaining editable arguments',()=>{
 let edit=editExpression('',0,0,'function','sin');assert.deepEqual(edit,{value:'sin()',start:4,end:4});edit=editExpression(edit.value,edit.start,edit.end,'insert','30');assert.equal(edit.value,'sin(30)');assert.equal(calculate(edit.value,{angle:'deg'}),'0.5');
 assert.equal(editExpression('2+3',3,3,'square').value,'2+(3)^2');assert.equal(editExpression('2+sin(30)',9,9,'square').value,'2+(sin(30))^2');assert.equal(editExpression('123',0,3,'fraction').value,'(123)/()');assert.equal(nextArgument('(123)/()',0),7);assert.equal(editExpression('log10(100)',10,10,'reciprocal').value,'1/(log10(100))');assert.deepEqual(editExpression('12',2,2,'backspace'),{value:'1',start:1,end:1});assert.equal(editExpression('12+3',0,4,'function','sqrt').value,'sqrt(12+3)');assert.equal(normalizeSymbols('2\u00d7\u03c0\u22123\u00b2'),'2*pi-3^2');
 assert.equal(validWorksheet(Array(100).fill('1')),true);assert.equal(validWorksheet(Array(101).fill('1')),false);assert.equal(validWorksheet(['1'.repeat(2001)]),false);assert.equal(validWorksheet(Array(11).fill('1'.repeat(2000))),false);
});
test('visible calculator functions retain restricted decimal arithmetic, units, angles and exact bases',()=>{
 for(const [expression,result] of [['sqrt(9)','3'],['cbrt(27)','3'],['log10(100)','2'],['log2(8)','3'],['abs(-2)','2'],['floor(1.9)','1'],['ceil(1.1)','2'],['round(1.6)','2'],['0.1+0.2','0.3'],['25 degC to degF','77 degF'],['10 mL to L','0.01 L']]){assert.equal(calculate(expression),result);assert.equal(typeof calculationPreview(expression),'string');}
 assert.equal(calculate('sin(pi/2)'),'1');assert.equal(calculate('asin(0.5)',{angle:'deg'}),'30');assert.equal(calculate('cos(60)',{angle:'deg'}),'0.5');assert.equal(calculate('tan(45)',{angle:'deg'}),'1');assert.equal(convertBase('ffffffffffffffff',16,10),'18446744073709551615');
 for(const expression of ['1/0','sqrt(-1)','import(1)','x=2','random()'])assert.throws(()=>calculate(expression));assert.throws(()=>calculationPreview('import(1)'));
});
test('statistics builder preserves entered numeric precision and selects sample variance semantics',()=>{
 assert.equal(statisticExpression('mean','2\n4, 6'),'mean(2, 4, 6)');assert.equal(calculate(statisticExpression('mean','2 4 6')),'4');assert.equal(calculate(statisticExpression('std','2 4 6')),'2');assert.equal(calculate(statisticExpression('variance','2 4 6')),'4');assert.equal(statisticExpression('sum','9007199254740993 1'),'sum(9007199254740993, 1)');assert.equal(calculate(statisticExpression('sum','9007199254740993 1')),'9.007199254740994e+15');assert.equal(statisticExpression('mean',''),null);assert.equal(statisticExpression('mean','1 banana'),null);assert.equal(statisticExpression('mean',Array(201).fill('1').join(' ')),null);
});
