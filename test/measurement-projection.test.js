import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exactRational} from '../src/web/measurement-model.js';
import {rationalProjection,safeDecimalProjection,safeRationalProjection} from '../src/web/measurement-projection.js';
import {createFigure,parseFigureCSV} from '../src/web/figure-model.js';
import {readDelimitedTable} from '../src/web/tabular-data.js';
import {mapFigureTable,suggestFigureMapping} from '../src/web/figure-import-model.js';

test('safe plotting rejects precision loss regardless of decimal spelling',()=>{
 for(const raw of ['9007199254740993','9007199254740993.0','9.007199254740993e15','1.000000000000000000001','0.100000000000000000001','1e-999','0x10','Infinity']){
  assert.throws(()=>safeDecimalProjection(raw),undefined,raw);
 }
 for(const raw of ['0.1','1.0000000000000002','0','-0','123.000','1e-100','9007199254740991','9007199254740992','1e20'])assert.equal(safeDecimalProjection(raw),Number(raw));
 assert.throws(()=>safeDecimalProjection('1e100'));
});

test('rational conversion rounds directly with ties to even, including subnormal and maximum values',()=>{
 const d=2n**53n;
 for(const sign of [1n,-1n]){
  assert.equal(rationalProjection({numerator:sign*(d+1n),denominator:d}),Number(sign));
  assert.equal(rationalProjection({numerator:sign*(d+3n),denominator:d}),Number(sign)*(1+2*Number.EPSILON));
 }
 assert.equal(rationalProjection({numerator:3n,denominator:2n**1075n}),2*Number.MIN_VALUE);
 assert.equal(rationalProjection({numerator:1n,denominator:2n**1074n}),Number.MIN_VALUE);
 assert.throws(()=>rationalProjection({numerator:1n,denominator:2n**1075n}));
 assert.equal(rationalProjection({numerator:(2n**53n-1n)*2n**971n,denominator:1n}),Number.MAX_VALUE);
 assert.throws(()=>rationalProjection({numerator:2n**1024n,denominator:1n}));
 assert.equal(rationalProjection({numerator:0n,denominator:1n}),0);
});

test('safe projection uses exact identity consistently across numeral bases and fractions',()=>{
 for(let radix=2;radix<=36;radix++){
  assert.equal(safeRationalProjection(exactRational('10','radix',radix)),radix);
  assert.equal(safeRationalProjection(exactRational('-0010','radix',radix)),-radix);
 }
 assert.equal(safeRationalProjection(exactRational('0.3','radix-fraction',6)),0.5);
 assert.equal(safeRationalProjection(exactRational('1/2','rational',10)),0.5);
 for(const [raw,representation,radix] of [['0.1','radix-fraction',6],['1/6','rational',10],[(2n**53n+1n).toString(6),'radix',6],['1'+'0'.repeat(100)+'/1','rational',10]])assert.throws(()=>safeRationalProjection(exactRational(raw,representation,radix)),undefined,raw);
 assert.equal(safeRationalProjection(exactRational((2n**53n).toString(6),'radix',6)),9007199254740992);
});

test('small fractions, large retained integers and decimal exponents match independently parsed numbers',()=>{
 for(const raw of ['1e-12','1e-100','1e100','18446744073709551615','0.12345678901234567890123456789','-3.141592653589793238462643383279','2.2250738585072014e-308','4.9406564584124654e-324']){
  assert.equal(rationalProjection(exactRational(raw)),Number(raw),raw);
 }
 for(let i=1;i<250;i++){
  const raw=(BigInt(i)**19n).toString()+'e'+(-i%300-70);
  assert.equal(rationalProjection(exactRational(raw)),Number(raw),raw);
 }
 assert.equal(rationalProjection(exactRational('0.1','radix-fraction',6)),0.16666666666666666);
});

test('CSV previews reject rounded coordinates and uncertainty until an explicit retained-dataset policy is used',()=>{
 const figure=createFigure(),source='X,Y,Error\n1.00000000000000000001,9007199254740993.0,0.10000000000000000001',table=readDelimitedTable(source),mapping={...suggestFigureMapping(table,figure),values:[{column:1,error:2}]},before=structuredClone(figure);
 const result=mapFigureTable(table,mapping,figure);assert.equal(result.figure,null);assert.deepEqual(result.issues.map(i=>i.column),[0,1,2]);
 const approximate=mapFigureTable(table,{...mapping,numericPolicy:'approximate'},figure);assert.deepEqual(approximate.issues,[]);assert.deepEqual(approximate.figure.series[0].points,[{x:1,y:9007199254740992,error:.1}]);assert.match(approximate.warnings.join(' '),/explicitly rounded/);
 assert.deepEqual(figure,before);assert.equal(table.rows[0].cells[1],'9007199254740993.0');
 assert.throws(()=>parseFigureCSV('X,Y\n0,9007199254740993.0'));
 assert.throws(()=>parseFigureCSV('Series,X,Y,Uncertainty\nA,0,1,0.10000000000000000001'));
 for(const raw of ['1e-999','0x10']){
  const table=readDelimitedTable('X,Y\n0,'+raw);const mapped=mapFigureTable(table,{...mapping,values:[{column:1,error:null}],numericPolicy:'approximate'},figure);assert.equal(mapped.figure,null);
 }
});
