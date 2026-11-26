import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,mkdir,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DeviceStore} from '../src/security/device-store.js';

test('parallel first-use identity requests share one protected key and retry after a failed creation',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'observanda-identity-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let protectedCount=0,fail=true;const protector={available:()=>true,protect:async bytes=>{protectedCount++;await delay(30);if(fail)throw Error('Synthetic key protection unavailable');return Buffer.from(bytes);},unprotect:async bytes=>Buffer.from(bytes)},file=path.join(directory,'device.json'),stores=Array.from({length:12},()=>new DeviceStore({file,protector}));
 const failed=await Promise.allSettled(stores.map(s=>s.identity()));assert.ok(failed.every(r=>r.status==='rejected'));assert.equal(protectedCount,1);assert.deepEqual(await readdir(directory),['device.json.lock']);
 fail=false;const identities=await Promise.all(stores.map(s=>s.identity()));assert.equal(protectedCount,2);assert.ok(identities.every(i=>i.id===identities[0].id));assert.deepEqual(await readdir(directory),['device.json','device.json.lock']);assert.deepEqual((await stores[4].privateKey()).identity,identities[0]);
});

test('a competing process lock is waited for without removing another creator lock',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'observanda-identity-lock-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'device.json'),lock=file+'.lock',protector={available:()=>true,protect:async bytes=>Buffer.from(bytes),unprotect:async bytes=>Buffer.from(bytes)};
 const {workspaceDatabaseLease}=await import('../src/workspace-database-lease.js'),lease=await workspaceDatabaseLease(null,{file:lock});
 const request=new DeviceStore({file,protector}).identity();await delay(100);assert.deepEqual(await readdir(directory),['device.json.lock']);await lease.close();assert.match((await request).id,/^[a-f0-9]{64}$/);
});

test('the device key is decrypted once for many unlocks, and again after a lock or a changed device file',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'observanda-identity-memory-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let unprotected=0;const protector={available:()=>true,protect:async bytes=>Buffer.from(bytes),unprotect:async bytes=>{unprotected++;await delay(20);return Buffer.from(bytes);}};
 const file=path.join(directory,'device.json'),store=new DeviceStore({file,protector}),identity=await store.identity();
 // Opening many lab books at once shares one decryption.
 const keys=await Promise.all(Array.from({length:8},()=>store.privateKey()));
 assert.equal(unprotected,1);assert.ok(keys.every(value=>value.identity.id===identity.id&&value.key===keys[0].key));
 await store.privateKey();assert.equal(unprotected,1);
 // A manual lock forgets the key; the next unlock decrypts it again.
 store.forgetPrivateKey();await store.privateKey();assert.equal(unprotected,2);
 // A replaced device file is never answered with the earlier key.
 await rm(file);const replaced=await store.identity();assert.notEqual(replaced.id,identity.id);
 assert.equal((await store.privateKey()).identity.id,replaced.id);assert.equal(unprotected,3);
 // A failed decryption is not kept.
 store.forgetPrivateKey();protector.unprotect=async()=>{unprotected++;throw Object.assign(Error('Synthetic unavailable'),{code:'DEVICE_UNAVAILABLE'});};
 await assert.rejects(store.privateKey());await assert.rejects(store.privateKey());assert.equal(unprotected,5);
});
