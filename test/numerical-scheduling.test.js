import test from 'node:test';
import assert from 'node:assert/strict';
import {spectrumSchedulingFixture,uncertaintySchedulingFixture} from './numerical-scheduling-fixture.js';

async function heartbeat(operation){let turns=0;const timer=setInterval(()=>turns++,1);try{const value=await operation();return {value,turns};}finally{clearInterval(timer);}}
for(const count of [1024,4096])test('cached spectrum readers release the event loop while retaining every bin at '+count,{timeout:120000},async t=>{
 const fixture=spectrumSchedulingFixture(count),start=performance.now(),{value,turns}=await heartbeat(()=>fixture.run());
 assert.equal(value.count,count);assert.equal(fixture.stats.reads,count);assert.equal(fixture.stats.outputs,count);assert.equal(fixture.stats.slices,count/32*(Math.log2(count)+2));assert.ok(turns>0,'A timer must run before the calculation finishes');
 // These input values have an independently exact zero-frequency coefficient.
 const sum=Array.from({length:count},(_,index)=>(index*73+19)%257-128).reduce((total,value)=>total+value,0);assert.equal(fixture.records.get('output:0').real.spelling,sum+'/1');
 t.diagnostic(JSON.stringify({count,heartbeatTurns:turns,elapsedMs:Math.round(performance.now()-start),...fixture.stats}));
});
for(const [kind,create]of [['spectrum',()=>spectrumSchedulingFixture(4096)],['uncertainty',()=>uncertaintySchedulingFixture(48)]])test('a timer cancels cached '+kind+' work before it finishes',{timeout:120000},async t=>{
 const fixture=create(),controller=new AbortController();let requested;const start=performance.now(),timer=setTimeout(()=>{requested=performance.now();controller.abort();},25);
 try{await assert.rejects(fixture.run({signal:controller.signal}),{name:'AbortError'});assert.ok(requested!==undefined);t.diagnostic(JSON.stringify({kind,cancelTimerLagMs:Math.round(requested-start-25),cancelCompletionMs:Math.round(performance.now()-requested),...fixture.stats}));}finally{clearTimeout(timer);}
});
test('cached covariance elimination yields without changing exact correlated variance',{timeout:120000},async t=>{
 const fixture=uncertaintySchedulingFixture(48),{value,turns}=await heartbeat(()=>fixture.run());assert.ok(turns>0);assert.equal(value.variance.scalar.spelling,'2352/1');assert.equal(fixture.stats.reads,48*49/2);t.diagnostic(JSON.stringify({count:48,heartbeatTurns:turns,...fixture.stats}));
});
