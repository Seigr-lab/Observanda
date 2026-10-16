import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CalendarSources} from '../src/calendar/service.js';
import {sampleNotebook} from '../src/sample.js';

const range={from:'2026-10-01',to:'2026-11-01',timeZone:'UTC'};
function fixture(){
 const book=sampleNotebook(),id=randomUUID();
 const source={id,type:'subscription',data:{name:'Workshop',projectId:null,color:'#3958ba',url:'https://calendar.example.invalid/workshops.ics',enabled:true}};
 const workspace={outline:async()=>({metadata:book})};
 let failing=false,calls=0,title='Original workshop';
 const service=new CalendarSources({
  read:async()=>({revision:1,sources:[],events:[],connections:source.data.enabled?[source]:[]}),
  fetch:async()=>{calls++;if(failing)throw Error('Synthetic feed interruption');return title;},
  parse:async text=>[{id:'workshop',title:text,startsAt:'2026-10-18',endsAt:'2026-10-19',allDay:true}]
 });
 return {service,workspace,source,get calls(){return calls;},set failing(value){failing=value;},set title(value){title=value;}};
}

test('a failed refresh stays visible during source navigation and explicit refresh recovers',async()=>{
 const f=fixture();
 assert.equal((await f.service.data(f.workspace,range)).events[0].title,'Original workshop');
 f.failing=true;
 const failed=await f.service.data(f.workspace,range,{refresh:true});
 assert.equal(failed.events.length,0);assert.equal(failed.sources[0].error,'Calendar could not refresh.');
 const revisited=await f.service.data(f.workspace,range);
 assert.equal(revisited.events.length,0);assert.equal(revisited.sources[0].error,failed.sources[0].error);assert.equal(revisited.version,failed.version);assert.equal(f.calls,2);
 f.failing=false;f.title='Updated workshop';
 const recovered=await f.service.data(f.workspace,range,{refresh:true});
 assert.equal(recovered.events[0].title,'Updated workshop');assert.equal(recovered.sources[0].error,undefined);assert.notEqual(recovered.version,failed.version);assert.equal(f.calls,3);
});

test('failed subscriptions retry after one minute and changed or disabled sources release failure state',async()=>{
 const f=fixture();f.failing=true;
 await f.service.data(f.workspace,range);assert.equal(f.calls,1);
 f.failing=false;f.title='Recovered automatically';
 f.service.cache.get(f.source.id).at=Date.now()-60001;
 assert.equal((await f.service.data(f.workspace,range)).events[0].title,'Recovered automatically');assert.equal(f.calls,2);
 f.failing=true;await f.service.data(f.workspace,range,{refresh:true});assert.equal(f.calls,3);
 f.failing=false;f.source.data.url='https://calendar.example.invalid/replacement.ics';
 assert.equal((await f.service.data(f.workspace,range)).sources[0].error,undefined);assert.equal(f.calls,4);
 f.failing=true;await f.service.data(f.workspace,range,{refresh:true});
 f.source.data.enabled=false;f.service.reconcile([f.source]);
 assert.equal(f.service.cache.size,0);assert.deepEqual((await f.service.data(f.workspace,range)).sources,[]);
});

test('an aborted refresh does not replace the last completed cache result',async()=>{
 const f=fixture();await f.service.data(f.workspace,range);
 const controller=new AbortController();
 f.service.fetch=async()=>{controller.abort();throw controller.signal.reason;};
 await assert.rejects(f.service.data(f.workspace,range,{refresh:true,signal:controller.signal}),{name:'AbortError'});
 const result=await f.service.data(f.workspace,range);
 assert.equal(result.events[0].title,'Original workshop');assert.equal(result.sources[0].error,undefined);
});
