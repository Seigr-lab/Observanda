import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PagedMedian} from '../src/paged-median.js';
import {createFigureMapper,mapFigureTable} from '../src/web/figure-import-model.js';
import {createFigure} from '../src/web/figure-model.js';

test('a retained median checkpoint resumes exact ranks without replaying earlier values',async()=>{
 const files=new Map(),state=new Map(),options={blockSize:8,state:{read:async key=>state.get(key),write:async(key,value)=>state.set(key,value)},read:async name=>files.get(name),write:async(name,value)=>files.set(name,value),remove:async names=>names.forEach(name=>files.delete(name))};
 const first=new PagedMedian(options);
 for(let i=0;i<19;i++){first.add(i%3,i);await first.flush();}
 assert.throws(()=>first.checkpoint(),{code:'INVALID'});await first.flush(true);
 const checkpoint=first.checkpoint(),resumed=new PagedMedian(options);resumed.restore(checkpoint);
 for(let i=19;i<41;i++){resumed.add(i%3,i);await resumed.flush();}
 await resumed.finish();for(let group=0;group<3;group++){
  const values=Array.from({length:41},(_,i)=>i).filter(i=>i%3===group),middle=Math.floor(values.length/2);
  assert.equal(await resumed.value(group),values.length%2?values[middle]:(values[middle-1]+values[middle])/2);
 }
 for(const value of [{...checkpoint,sequence:0},{...checkpoint,levels:[{id:'1',count:0,pages:1,hash:'0'.repeat(64)}]},{...checkpoint,levels:[checkpoint.levels.find(Boolean),checkpoint.levels.find(Boolean)]}])assert.throws(()=>new PagedMedian(options).restore(value),{code:'MATERIAL_MISSING'});
});

test('incremental summaries retain missing groups, counts and individual measurements',()=>{
 const table={columns:[{label:'Take'},{label:'Level'}],rows:[
  {cells:['A','10']},{cells:['A','30']},{cells:['B','']},{cells:['C','-5']},{cells:['C','15']}
 ]},base=createFigure(),mapping={x:0,xKind:'category',values:[{column:1,error:null}],group:null,order:'source',kind:'bar',mode:'replace',decimal:'.'};
 const expected={count:[2,1,2],mean:[20,null,5],median:[20,null,5],sum:[40,null,10],min:[10,null,-5],max:[30,null,15]};
 for(const [operation,values] of Object.entries(expected)){
  const mapper=createFigureMapper(table,{...mapping,operation},base);
  table.rows.forEach(row=>mapper.add(row));const result=mapper.finish();
  assert.deepEqual(result.issues,[]);assert.deepEqual(result.figure.series[0].points.map(p=>p.y),values);
  assert.equal(result.figure.summary.rows,5);assert.equal(result.figure.summary.missing,operation==='count'?0:1);
 }
 assert.deepEqual(mapFigureTable(table,{...mapping,operation:'raw'},base).figure.series[0].points.map(p=>p.y),[10,30,null,-5,15]);
 const bounded=createFigureMapper(table,{...mapping,operation:'raw'},base,{limits:{points:2}});
 table.rows.forEach(row=>bounded.add(row));assert.equal(bounded.finish().limited,true);assert.equal(bounded.finish().figure,null);
});

test('encrypted-page median sorting keeps exact ranks across blocks and detects altered scratch',async()=>{
 const files=new Map(),expected=new Map(),controller=new AbortController();let maximumPage=0;
 const median=new PagedMedian({blockSize:16,signal:controller.signal,
  read:async name=>files.get(name)??null,
  write:async(name,text)=>{maximumPage=Math.max(maximumPage,JSON.parse(text).length);files.set(name,text);},
  remove:async names=>names.forEach(name=>files.delete(name))
 });
 for(let i=0;i<999;i++){
  const key=i%7,value=((i*137)%701)-350;median.add(key,value);
  if(!expected.has(key))expected.set(key,[]);expected.get(key).push(value);await median.flush();
 }
 await median.finish();assert.equal(maximumPage,16);assert.equal(median.peakBuffer,16);
 for(const [key,values] of expected){values.sort((a,b)=>a-b);const middle=Math.floor(values.length/2);assert.equal(median.value(key),values.length%2?values[middle]:values[middle-1]/2+values[middle]/2);}
 const run=median.levels.find(Boolean);files.set(run.id+'-0.json','[]');
 await assert.rejects(async()=>{for await(const value of median.values(run)){void value;}},{code:'MATERIAL_MISSING'});
 controller.abort();await assert.rejects(median.page([[0,1]]),{name:'AbortError'});
});

test('retained median state and run descriptors stay bounded as distinct groups grow',async()=>{
 const files=new Map(),state=new Map();let maximumCounts=0,maximumDeletion=0;
 const median=new PagedMedian({blockSize:128,state:{read:async key=>state.get(key),write:async(key,value)=>state.set(key,value)},
  read:async name=>files.get(name),write:async(name,value)=>files.set(name,value),remove:async names=>{maximumDeletion=Math.max(maximumDeletion,names.length);for(const name of names)files.delete(name);}});
 const groups=10017;
 for(let row=0;row<groups*2;row++){
  const key=row%groups;median.add(key,key+(row<groups?0:2));maximumCounts=Math.max(maximumCounts,median.counts.size);await median.flush();
 }
 await median.finish();assert.equal(await median.value(groups-1),groups);assert.equal(await median.value(0),1);
 assert.equal(median.counts.size,0);assert.equal(median.medians.size,0);assert.ok(maximumCounts<=128);assert.ok(maximumDeletion<=32);
 assert.deepEqual(Object.keys(median.levels[0]).sort(),['count','hash','id','pages']);assert.equal(median.levels[0].count,groups*2);
 assert.equal(state.size,groups*2);await assert.rejects(median.value(groups),{code:'MATERIAL_MISSING'});
 const run=median.levels[0],last=run.id+'-'+(run.pages-1)+'.json';files.set(last,JSON.stringify([[groups-1,-999]]));
 await assert.rejects(async()=>{for await(const value of median.values(run)){void value;}},{code:'MATERIAL_MISSING'});
});
