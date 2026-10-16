import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {compatibleManagedRuntime} from '../src/postgres-runtime-compatibility.js';

test('managed updates reject engine upgrades and downgrades without falling back to another installation',async()=>{
 const current={bin:path.resolve('original/bin'),major:17},before=structuredClone(current),seen=[];
 for(const major of [16,18,99])await assert.rejects(compatibleManagedRuntime(current,'replacement/bin',async bin=>{seen.push(bin);return major;}),{code:'DATABASE_UPDATE'});
 assert.deepEqual(seen,Array(3).fill(path.resolve('replacement/bin')));assert.deepEqual(current,before);
});

test('a missing or invalid requested runtime is not hidden by an older installation',async()=>{
 const config={bin:path.resolve('original/bin'),major:17},failure=Error('Unavailable executable');
 await assert.rejects(compatibleManagedRuntime(config,'replacement/bin',async()=>{throw failure;}),error=>error===failure);
});

test('command-line installations retain their saved runtime when no replacement is requested',async()=>{
 const config={bin:path.resolve('managed/runtime/bin'),major:17};
 assert.equal(await compatibleManagedRuntime(config,'',async bin=>{assert.equal(bin,config.bin);return 17;}),config.bin);
});
