import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tableNumber,tableNumberText,readDelimitedTable} from '../src/web/tabular-data.js';
import {exactFigureValue} from '../src/web/figure-mapping-values.js';
import {figureColumns} from '../src/web/figure-import-model.js';

test('grouped thousands follow the chosen decimal mark in strict groups of three',()=>{
 for(const [value,decimal,expected] of [['1,234.5','.','1234.5'],['1.234,5',',','1234.5'],['1 234,5',',','1234.5'],['1\u00a0234\u00a0567,25',',','1234567.25'],['1\u202f234.5','.','1234.5'],["1'000.5",'.','1000.5'],['-12,345,678','.','-12345678'],['1,000e3','.','1000e3'],['1.234',',','1234'],['1.234','.','1.234'],['1,5',',','1.5'],[' 42 ','.','42']])
  assert.equal(tableNumberText(value,decimal),expected,value+' '+decimal);
 // Ambiguous or malformed grouping is refused rather than guessed.
 for(const [value,decimal] of [['1,5','.'],['1.50',','],['12,34','.'],['1,234,5678','.'],['1,234.5',','],['1\u00a0234 567',','],['1..234',','],['0x10','.'],['Infinity','.']])
  assert.ok(Number.isNaN(tableNumber(value,decimal)),value+' '+decimal);
 assert.equal(tableNumber('','.'),null);assert.equal(tableNumber('1,234.5','.'),1234.5);
});

test('grouped values keep every digit in exact figure values and are recognised as numeric columns',()=>{
 assert.equal(exactFigureValue('12,345,678,901,234,567,890.123456789',null,{decimal:'.'}),'12345678901234567890123456789/1000000000');
 assert.equal(exactFigureValue('1.234.567,000000000000000001',null,{decimal:','}),exactFigureValue('1234567.000000000000000001',null,{decimal:'.'}));
 const table=readDelimitedTable('Time;Current\n1;1.234,5\n2;12.345,25',{delimiter:';'});
 assert.equal(figureColumns(table,',')[1].kind,'number');assert.equal(figureColumns(table,'.')[1].kind,'text');
});
