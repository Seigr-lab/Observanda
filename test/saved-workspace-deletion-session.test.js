import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SavedWorkspaceDeletion} from '../src/saved-workspace-deletion.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('expired deletion reviews release credentials, defer active commands and drain shutdown once',async()=>{
 const deletion=new SavedWorkspaceDeletion({}),gate=deferred();let closed=0;
 const bytes=Buffer.alloc(32,7),plan={plan:{source:'selected'},expires:0,vault:{id:'owner',key:bytes},projects:{close:async()=>{closed++;await gate.promise;}}};
 deletion.plans.set('review',plan);deletion.running.add('selected');deletion.expire();assert.equal(closed,0);
 deletion.running.clear();deletion.expire();deletion.expire();assert.equal(closed,1);assert.equal(deletion.plans.size,0);
 let finished=false;const closing=deletion.close().then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);gate.resolve();await closing;
 assert.equal(closed,1);assert.ok(bytes.every(value=>value===0));assert.equal(deletion.disposals.size,0);
});

test('a failed expired-owner shutdown clears keys and is retained for retry',async()=>{
 const deletion=new SavedWorkspaceDeletion({});let attempts=0;
 const bytes=Buffer.alloc(32,9),plan={plan:{source:'selected'},expires:0,vault:{id:'owner',key:bytes},projects:{close:async()=>{if(++attempts===1)throw Error('Worker has not stopped');}}};
 deletion.plans.set('review',plan);deletion.expire();await Promise.allSettled([...deletion.disposals.values()]);
 assert.ok(bytes.every(value=>value===0));assert.equal(deletion.disposals.size,1);deletion.expire();await deletion.close();assert.equal(attempts,2);assert.equal(deletion.disposals.size,0);
});
