import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameJSONData} from '../src/web/json-data-equality.js';

test('JSON data equality preserves persisted spelling and ordering without serializing values',()=>{
 const samples=[undefined,null,false,true,0,-0,1,NaN,Infinity,'','9007199254740993','\\"\n\ud800😀',[],[null],[undefined],Array(1),[1,2],{},{a:undefined},{a:1,b:2},{b:2,a:1},{a:null},{a:NaN},{a:[{value:'1/3'}]},Object.assign(Object.create(null),{a:[{value:'1/3'}]})];
 const expected=samples.map(a=>samples.map(b=>JSON.stringify(a)===JSON.stringify(b))),stringify=JSON.stringify;
 JSON.stringify=()=>{throw Error('Equality serialized a value');};
 try{for(const [i,a] of samples.entries())for(const [j,b] of samples.entries())assert.equal(sameJSONData(a,b),expected[i][j],i+'/'+j);}
 finally{JSON.stringify=stringify;}
});
test('JSON equality follows nested arrays incrementally and does not invoke application code',()=>{
 let left={value:1},right={value:1};for(let i=0;i<15000;i++){left=[left];right=[right];}
 assert.equal(sameJSONData(left,right),true);
 const shared={value:'retained'},a={left:shared,right:shared};assert.equal(sameJSONData(a,{left:{value:'retained'},right:{value:'retained'}}),true);
 const cycleA={a:1},cycleB={a:1};cycleA.next=cycleA;cycleB.next=cycleB;assert.throws(()=>sameJSONData(cycleA,cycleB),/Expected JSON data/);
 let invoked=false;const getter={get value(){invoked=true;return 1;}};assert.throws(()=>sameJSONData(getter,{value:1}),/Expected JSON data/);assert.equal(invoked,false);
 assert.equal(sameJSONData({first:'different',last:shared},{first:'other',last:getter}),false,'stop at the first difference');
});
