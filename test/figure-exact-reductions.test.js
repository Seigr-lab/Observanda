import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFigure} from '../src/web/figure-model.js';
import {mapFigureTable,createFigureMapper} from '../src/web/figure-import-model.js';
import {exactRational} from '../src/web/measurement-model.js';
import {PagedMedian} from '../src/paged-median.js';
import {compareRationalText,sumRationalText} from '../src/web/measurement-reduction.js';
const mapping={x:0,xKind:'category',values:[{column:1,error:null}],group:null,order:'source',kind:'bar',mode:'replace',decimal:'.'};
const table=rows=>({columns:[{label:'Group'},{label:'Value'}],rows:rows.map(cells=>({cells}))});

test('figure reductions operate before numeric projection, including intermediate values outside binary64',()=>{
 for(const rows of [[['A','9007199254740993'],['A','-9007199254740992']],[['A','1e400'],['A','1'],['A','-1e400']],[['A','0.1'],['A','0.2'],['A','-0.3'],['A','1']]]){
  const result=mapFigureTable(table(rows),{...mapping,operation:'sum'},createFigure());assert.deepEqual(result.issues,[]);assert.equal(result.figure.series[0].points[0].y,1);assert.equal(result.warnings.some(w=>w.includes('rounded')),false);
 }
 for(const operation of ['mean','median']){
  const result=mapFigureTable(table([['A','9007199254740993'],['A','-9007199254740992']]),{...mapping,operation},createFigure());
  assert.deepEqual(result.issues,[]);assert.equal(result.figure.series[0].points[0].y,.5);
 }
 const thirds=table([['A','1'],['A','0'],['A','0']]);
 const refused=mapFigureTable(thirds,{...mapping,operation:'mean'},createFigure());assert.equal(refused.figure,null);assert.equal(refused.precision,true);
 const approximate=mapFigureTable(thirds,{...mapping,operation:'mean',numericPolicy:'approximate'},createFigure());assert.equal(approximate.figure.series[0].points[0].y,1/3);assert.ok(approximate.warnings.some(w=>w.includes('rounded')));
});

test('numeric grouping and sorting use exact identities even when projected positions collide',()=>{
 const source=table([['9007199254740993','7'],['9007199254740992','4'],['9007199254740992.0','5']]);
 for(const operation of ['sum','raw']){
  const result=mapFigureTable(source,{...mapping,xKind:'number',operation,order:'ascending',numericPolicy:'approximate'},createFigure());
  assert.deepEqual(result.issues,[]);assert.deepEqual(result.figure.series[0].points.map(p=>p.y),operation==='sum'?[9,7]:[4,5,7]);
  assert.ok(result.figure.series[0].points.every(p=>p.x===9007199254740992));assert.ok(result.warnings.some(w=>w.includes('Distinct exact horizontal')));
 }
 const result=mapFigureTable(table([['1.0','2'],['1','3']]),{...mapping,xKind:'number',operation:'sum'},createFigure());
 assert.deepEqual(result.figure.series[0].points,[{x:1,y:5,error:null}]);
});

test('an arithmetic capacity refusal is reported without applying a partial or rounded figure',()=>{
 const denominator=10n**4100n;
 const mapper=createFigureMapper(table([]),{...mapping,operation:'sum'},createFigure(),{parseNumber:raw=>exactRational(raw,'rational')});
 for(const row of table([['A','1/'+denominator],['A','1/'+(denominator+1n)]]).rows)mapper.add(row);
 const result=mapper.finish();assert.equal(result.figure,null);assert.equal(result.precision,true);assert.match(result.issues[0].message,/exact summary exceeds/);
});

test('typed fractions retain exact reduction and approximation never changes observation counts',()=>{
 for(const operation of ['sum','mean','median','min','max']){
  const mapper=createFigureMapper(table([]),{...mapping,operation,numericPolicy:'approximate'},createFigure(),{parseNumber:raw=>exactRational(raw,'rational')});
  for(const row of table([['A','1/3'],['A','2/3'],['B','']]).rows)mapper.add(row);
  const result=mapper.finish();assert.deepEqual(result.issues,[]);assert.deepEqual(result.figure.series[0].points.map(p=>p.y),[{sum:1,mean:.5,median:.5,min:1/3,max:2/3}[operation],null]);
 }
 const counted={columns:[{label:'X'},{label:'Y'},{label:'Count'}],rows:[{cells:['1','2','1.0000000000000000001']}]};
 const rejected=mapFigureTable(counted,{...mapping,xKind:'number',operation:'raw',values:[{column:1,error:null,count:2}],numericPolicy:'approximate'},createFigure());
 assert.equal(rejected.figure,null);assert.equal(rejected.precision,true);
});

test('exact median pages follow byte as well as row bounds and retain all ranks',async()=>{
 const files=new Map(),denominator=10n**2000n,low=(denominator-1n)+'/'+denominator,high=(denominator+1n)+'/'+denominator;let maximum=0;
 const median=new PagedMedian({blockSize:2048,pageBytes:32768,compareValues:compareRationalText,midpoint:(a,b)=>sumRationalText(a,b,2n),
  read:async name=>files.get(name),write:async(name,text)=>{maximum=Math.max(maximum,Buffer.byteLength(text));files.set(name,text);},remove:async names=>names.forEach(name=>files.delete(name))});
 for(let i=0;i<144;i++){median.add(0,i%2?low:high);await median.flush();}
 await median.finish();assert.equal(median.value(0),'1/1');assert.ok(maximum<=32768);assert.ok(median.peakBuffer<10);assert.equal(median.levels[0].count,144);
 let count=0;for await(const row of median.values(median.levels[0])){assert.ok([low,high].includes(row[1]));count++;}assert.equal(count,144);
});
