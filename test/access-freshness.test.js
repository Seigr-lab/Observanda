import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DeviceStore} from '../src/security/device-store.js';
import {createKeyring,changeKeyringPassword,finishKeyring} from '../src/security/keyring.js';
import {keyringFingerprint} from '../src/security/access-trust.js';
import {readAccess,verifyAccess,changeAccess} from '../src/access.js';
import {workspaceAccess,updateWorkspaceAccess} from '../src/security/workspace-access.js';
import {exportAccessCheckpoint,inspectAccessCheckpoint,importAccessCheckpoint} from '../src/security/access-checkpoint.js';
import {clearVault,seal,unseal} from '../src/encryption.js';
import {randomBytes} from 'node:crypto';

const oldPassword='Synthetic previous password',newPassword='Synthetic current password';
async function fixture(t,{device=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-access-freshness-')),root=path.join(directory,'workspace'),file=path.join(root,'.observanda/access.json'),secret=randomBytes(32);
 const protector={available:()=>true,protect:async bytes=>seal(bytes,secret,'Synthetic protected device'),unprotect:async bytes=>unseal(bytes,secret,'Synthetic protected device')};
 const store=new DeviceStore({file:path.join(directory,'device.json'),protector}),created=await createKeyring({password:device?'':oldPassword,deviceStore:store});
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(created.value));
 t.after(async()=>{clearVault(created.vault);secret.fill(0);await rm(directory,{recursive:true,force:true});});
 return {directory,root,file,store,protector,...created};
}
async function unlock(root,store,password='',recovery=''){
 const vault=await verifyAccess(await readAccess(root),'',password,{deviceStore:store,recovery});try{return Buffer.from(vault.key);}finally{clearVault(vault);}
}

test('restoring old access files cannot revive old passwords and older copies use current credentials after restart',async t=>{
 const f=await fixture(t),old=await readFile(f.file);assert.deepEqual(await unlock(f.root,f.store,oldPassword),f.vault.key);
 const access=await readAccess(f.root,{deviceStore:f.store});
 await changeAccess(f.root,{username:'',password:newPassword,currentPassword:oldPassword},access.etag,{deviceStore:f.store});
 await writeFile(f.file,old);
 await assert.rejects(unlock(f.root,f.store,oldPassword),{code:'ACCESS_DENIED'});assert.deepEqual(await unlock(f.root,f.store,newPassword),f.vault.key);
 const reopened=new DeviceStore({file:f.store.file,protector:f.protector}),backup=path.join(f.directory,'older-copy');await mkdir(path.join(backup,'.observanda'),{recursive:true});await writeFile(path.join(backup,'.observanda/access.json'),old);
 await assert.rejects(unlock(backup,reopened,oldPassword),{code:'ACCESS_DENIED'});assert.deepEqual(await unlock(backup,reopened,newPassword),f.vault.key);
 const raw=await readAccess(backup),current=await readAccess(backup,{deviceStore:reopened});assert.notEqual(current.etag,raw.etag);assert.notEqual(current.value.auth,raw.value.auth);
 const retained=await readFile(path.join(reopened.accessTrust.directory,f.vault.id,'current.json'),'utf8');assert.ok(!retained.includes(oldPassword)&&!retained.includes(newPassword)&&!retained.includes(f.vault.key.toString('hex')));
});

test('revoked device unlock and rotated recovery grants stay revoked when their files are replayed',async t=>{
 const f=await fixture(t,{device:true}),original=await readFile(f.file);await unlock(f.root,f.store);
 await changeAccess(f.root,{username:'',password:newPassword},(await readAccess(f.root,{deviceStore:f.store})).etag,{deviceStore:f.store,vault:f.vault});
 const current=await readFile(f.file);await writeFile(f.file,original);await assert.rejects(unlock(f.root,f.store),{code:'DEVICE_UNKNOWN'});assert.deepEqual(await unlock(f.root,f.store,newPassword),f.vault.key);await writeFile(f.file,current);
 const first=await updateWorkspaceAccess(f.root,f.vault,{action:'recovery',etag:(await workspaceAccess(f.root,f.vault,{deviceStore:f.store})).etag,confirmed:true},{deviceStore:f.store}),previous=await readFile(f.file);
 const second=await updateWorkspaceAccess(f.root,f.vault,{action:'recovery',etag:first.etag,confirmed:true},{deviceStore:f.store});await writeFile(f.file,previous);
 await assert.rejects(unlock(f.root,f.store,'',first.recovery),{code:'ACCESS_DENIED'});assert.deepEqual(await unlock(f.root,f.store,'',second.recovery),f.vault.key);
});

test('an old vault key and a recomputed HMAC cannot establish an unknown access successor',async t=>{
 const f=await fixture(t);await unlock(f.root,f.store,oldPassword);
 await changeAccess(f.root,{username:'',password:newPassword,currentPassword:oldPassword},(await readAccess(f.root,{deviceStore:f.store})).etag,{deviceStore:f.store});
 const attack=finishKeyring({...structuredClone(f.value),username:'Untrusted successor'},f.vault);await writeFile(f.file,JSON.stringify(attack));
 await assert.rejects(verifyAccess(await readAccess(f.root),'Untrusted successor',oldPassword,{deviceStore:f.store}),{code:'ACCESS_STATE_CHANGED'});
 assert.notEqual((await f.store.accessTrust.current(f.vault.id)).sha256,keyringFingerprint(attack));
});

test('an interrupted workspace write preserves the new trusted grants and reports uncertain publication',async t=>{
 const f=await fixture(t);await unlock(f.root,f.store,oldPassword);
 const next=await changeKeyringPassword(f.value,f.vault,{password:newPassword,deviceStore:f.store});
 await assert.rejects(f.store.accessTrust.replace(f.value,next,f.vault,async()=>{throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});}),error=>error.code==='ACCESS_SAVE_UNCERTAIN'&&error.commitUncertain===true);
 assert.equal((await readAccess(f.root)).value.auth,f.value.auth);
 await assert.rejects(unlock(f.root,f.store,oldPassword),{code:'ACCESS_DENIED'});assert.deepEqual(await unlock(f.root,new DeviceStore({file:f.store.file,protector:f.protector}),newPassword),f.vault.key);
});

test('a verified current settings checkpoint opens an old backup on a new device without its old credentials',async t=>{
 const f=await fixture(t),old=await readFile(f.file);await unlock(f.root,f.store,oldPassword);
 await changeAccess(f.root,{username:'',password:newPassword,currentPassword:oldPassword},(await readAccess(f.root,{deviceStore:f.store})).etag,{deviceStore:f.store});
 const exported=await exportAccessCheckpoint(f.root,f.vault,f.store),other=new DeviceStore({file:path.join(f.directory,'other-device.json'),protector:f.protector});await writeFile(f.file,old);
 assert.equal((await inspectAccessCheckpoint(exported.checkpoint,other)).known,false);
 const options={verifiedFingerprint:exported.fingerprint,confirmed:true,password:newPassword};
 await assert.rejects(importAccessCheckpoint(f.root,exported.checkpoint,{...options,confirmed:false},other),{code:'ACCESS_CONFIRM'});
 await assert.rejects(importAccessCheckpoint(f.root,exported.checkpoint,{...options,verifiedFingerprint:'0'.repeat(64)},other),{code:'ACCESS_CONFIRM'});
 await assert.rejects(importAccessCheckpoint(f.root,exported.checkpoint,{...options,password:'incorrect'},other),{code:'ACCESS_DENIED'});
 assert.equal(await other.accessTrust.current(f.vault.id),null);
 await importAccessCheckpoint(f.root,exported.checkpoint,options,other);assert.deepEqual(await unlock(f.root,other,newPassword),f.vault.key);
 const prior={format:'observanda-access-v1',keyring:f.value};await assert.rejects(importAccessCheckpoint(f.root,prior,{...options,verifiedFingerprint:keyringFingerprint(f.value)},other),{code:'ACCESS_STATE_CHANGED'});
});

test('another device must explicitly verify an unknown settings change using its already trusted access',async t=>{
 const f=await fixture(t),other=new DeviceStore({file:path.join(f.directory,'other-device.json'),protector:f.protector});await unlock(f.root,other,oldPassword);
 await changeAccess(f.root,{username:'',password:newPassword,currentPassword:oldPassword},(await readAccess(f.root,{deviceStore:f.store})).etag,{deviceStore:f.store});
 const exported=await exportAccessCheckpoint(f.root,f.vault,f.store);
 await assert.rejects(unlock(f.root,other,newPassword),{code:'ACCESS_STATE_CHANGED'});
 await assert.rejects(importAccessCheckpoint(f.root,exported.checkpoint,{verifiedFingerprint:exported.fingerprint,confirmed:true,password:newPassword},other),{code:'ACCESS_DENIED'});
 await importAccessCheckpoint(f.root,exported.checkpoint,{verifiedFingerprint:exported.fingerprint,confirmed:true,password:oldPassword},other);
 await assert.rejects(unlock(f.root,other,oldPassword),{code:'ACCESS_DENIED'});assert.deepEqual(await unlock(f.root,other,newPassword),f.vault.key);
});
