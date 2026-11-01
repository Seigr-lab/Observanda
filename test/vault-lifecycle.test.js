import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onVaultRetire,retireVault,drainRetiredVault} from '../src/vault-lifecycle.js';
test('vault retirement aborts synchronously and drains every listener once',async()=>{
 const vault={},events=[];let release;const pending=new Promise(resolve=>{release=resolve;});onVaultRetire(vault,()=>{events.push('abort');return pending.then(()=>events.push('drained'));});
 const unsubscribe=onVaultRetire(vault,()=>assert.fail('Unsubscribed listener ran'));unsubscribe();onVaultRetire(vault,()=>{events.push('second');throw Error('cleanup failed');});
 retireVault(vault);assert.deepEqual(events,['abort','second']);retireVault(vault);release();await assert.rejects(drainRetiredVault(vault),/cleanup failed/);assert.deepEqual(events,['abort','second','drained']);
});
test('late cleanup from an old generation cannot unsubscribe a newly installed generation',async()=>{
 const vault={},first=Promise.withResolvers(),events=[];let unsubscribe;
 unsubscribe=onVaultRetire(vault,()=>first.promise.then(unsubscribe));retireVault(vault);onVaultRetire(vault,()=>{events.push('new');});first.resolve();await drainRetiredVault(vault);retireVault(vault);await drainRetiredVault(vault);assert.deepEqual(events,['new']);
});
