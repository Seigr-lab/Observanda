import {assertPrivateCatalogue} from './postgres-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {DeviceStore,WindowsProtector} from '../src/security/device-store.js';
import {createKeyring,unlockKeyring,grantDevice,recoveryKey,changeKeyringPassword} from '../src/security/keyring.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation,encryptedCopy,copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace,atomicWrite,serialize} from '../src/storage.js';
import {seal,unseal,encrypted} from '../src/encryption.js';
import {createNotebook} from '../src/model.js';
import {workspaceAccess,updateWorkspaceAccess} from '../src/security/workspace-access.js';
import {startServer} from '../src/server.js';

function syntheticProtector(){const secret=randomBytes(32);return {available:()=>true,protect:async b=>seal(b,secret,'test-only-os'),unprotect:async b=>unseal(b,secret,'test-only-os')};}
async function devices(){const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-keys-'));return {parent,a:new DeviceStore({file:path.join(parent,'a.json'),protector:syntheticProtector()}),b:new DeviceStore({file:path.join(parent,'b.json'),protector:syntheticProtector()})};}
test('device encryption is unique, authenticated, recoverable and extensible without rewriting content',async()=>{
 const {parent,a,b}=await devices(),root=path.join(parent,'work');
 const access=await createWorkspaceAccess('','',a),vault=takeCreatedVault(access);await initializeLocation(root,createNotebook('Private sentinel'),access,vault);
 const raw=await readFile(path.join(root,'workspace.observanda'));assert.ok(encrypted(raw));assert.ok(!raw.includes(Buffer.from('Private sentinel')));
 await assert.rejects(new Workspace(root).read(),{code:'ACCESS_LOCKED'});await assert.rejects(verifyAccess(await readAccess(root),'','',{deviceStore:b}),{code:'DEVICE_UNKNOWN'});
 const initial=await workspaceAccess(root,vault),identity=await b.identity();
 await assert.rejects(updateWorkspaceAccess(root,vault,{action:'grant',etag:initial.etag,identity,confirmed:true,verifiedFingerprint:'wrong'}),{code:'ACCESS_CONFIRM'});
 const shared=await updateWorkspaceAccess(root,vault,{action:'grant',etag:initial.etag,identity,confirmed:true,verifiedFingerprint:identity.id});
 assert.deepEqual(await readFile(path.join(root,'workspace.observanda')),raw);
 const other=await verifyAccess(await readAccess(root),'','',{deviceStore:b});assert.equal((await new Workspace(root,other).read()).book.title,'Private sentinel');
 await assert.rejects(updateWorkspaceAccess(root,vault,{action:'recovery',etag:initial.etag,confirmed:true}),{code:'CONFLICT'});
 const kit=await updateWorkspaceAccess(root,vault,{action:'recovery',etag:shared.etag,confirmed:true});
 const recovered=await verifyAccess(await readAccess(root),'','',{recovery:kit.recovery,deviceStore:b});assert.deepEqual(recovered.key,vault.key);
 assert.ok(!(await readFile(path.join(root,'.observanda/access.json'),'utf8')).includes(kit.recovery));
 const damaged=structuredClone((await readAccess(root)).value);damaged.devices.reverse();damaged.username='forged';
 await assert.rejects(unlockKeyring(damaged,{deviceStore:a}),{code:'ENCRYPTION_DAMAGED'});
 const rotated=await updateWorkspaceAccess(root,vault,{action:'recovery',etag:kit.etag,confirmed:true});
 await assert.rejects(verifyAccess(await readAccess(root),'','',{recovery:kit.recovery,deviceStore:b}),{code:'ACCESS_DENIED'});
 assert.ok(rotated.recovery!==kit.recovery);
 const copied=path.join(parent,'hosted');await copyWorkspace(await copyPlan(root,copied));assert.equal((await new Workspace(copied,other).read()).book.title,'Private sentinel');
 await unlink(path.join(root,'.observanda/access.json'));await assert.rejects(new Workspace(root).writeFile(path.join(root,'.observanda/leak'),'private'),{code:'ACCESS_LOCKED'});
});
test('password and device unlock remain encrypted; wrong passwords, foreign grants and unsupported OS fail closed',async()=>{
 const {a,b}=await devices(),first=await createKeyring({password:'long synthetic password',deviceStore:a});
 await assert.rejects(unlockKeyring(first.value,{password:'incorrect',deviceStore:a}),{code:'ACCESS_DENIED'});
 await assert.rejects(unlockKeyring(first.value,{deviceStore:a}),{code:'DEVICE_UNKNOWN'});
 assert.deepEqual((await unlockKeyring(first.value,{password:'long synthetic password',deviceStore:a})).key,first.vault.key);
 const device=await changeKeyringPassword(first.value,first.vault,{deviceStore:a});assert.deepEqual((await unlockKeyring(device,{deviceStore:a})).key,first.vault.key);
 const locked=await changeKeyringPassword(device,first.vault,{deviceStore:a,password:'second synthetic password'});assert.equal(locked.devices.length,0);
 const second=await createKeyring({deviceStore:b}),stolen=structuredClone(device);stolen.devices=second.value.devices;
 await assert.rejects(unlockKeyring(stolen,{deviceStore:b}),{code:'ACCESS_DENIED'});
 const unavailable=new DeviceStore({protector:{available:()=>false}});await assert.rejects(createKeyring({deviceStore:unavailable}),{code:'DEVICE_UNAVAILABLE'});
 assert.ok((await createKeyring({deviceStore:unavailable,password:'portable synthetic password'})).vault.key);
});
test('fresh encrypted successors change the data key and exclude earlier devices',async()=>{
 const {a,b,parent}=await devices(),root=path.join(parent,'old');
 const access=await createWorkspaceAccess('','',a),vault=takeCreatedVault(access);await initializeLocation(root,createNotebook('Private'),access,vault);
 const value=grantDevice(access,vault,await b.identity());await atomicWrite(path.join(root,'.observanda/access.json'),serialize(value));
 const oldKey=await unlockKeyring(value,{deviceStore:b}),next=await createWorkspaceAccess('','',a),nextVault=takeCreatedVault(next),destination=path.join(parent,'successor');
 await encryptedCopy(await copyPlan(root,destination),next,nextVault,vault);
 assert.notDeepEqual(nextVault.key,oldKey.key);await assert.rejects(new Workspace(destination,oldKey).read(),{code:'ENCRYPTION_DAMAGED'});
 await assert.rejects(unlockKeyring(next,{deviceStore:b}),{code:'DEVICE_UNKNOWN'});
 assert.equal((await new Workspace(destination,nextVault).read()).book.title,'Private');
 assert.equal((await new Workspace(root,oldKey).read()).book.title,'Private');
});
test('Windows device private key survives restart only through OS protection',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-dpapi-')),file=path.join(dir,'device.json'),store=new DeviceStore({file,protector:new WindowsProtector()});
 const identity=await store.identity(),fresh=new DeviceStore({file}),privateKey=await fresh.privateKey();
 assert.equal(privateKey.identity.id,identity.id);assert.ok(!(await readFile(file,'utf8')).includes('PRIVATE KEY'));
 const bytes=JSON.parse(await readFile(file,'utf8'));bytes.protectedKey=Buffer.from('corrupt').toString('base64');await writeFile(file,JSON.stringify(bytes));
 await assert.rejects(fresh.privateKey(),{code:'DEVICE_UNAVAILABLE'});
});
test('server creates encrypted workspaces by default, auto-unlocks only authorized devices and keeps manual locks',async t=>{
 const {parent,a,b}=await devices(),root=path.join(parent,'Secure by default');
 const app=await startServer({port:0,deviceStore:a});t.after(()=>app.close());
 async function client(server){const session=await fetch(server.origin+'/api/session',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify({token:server.launchToken})});const cookie=session.headers.get('set-cookie')?.split(';')[0];let context;
 return {setContext:v=>context=v,request:(route,data)=>fetch(server.origin+route,{method:data===undefined?'GET':'POST',headers:{Origin:server.origin,Cookie:cookie,'Content-Type':'application/json',...(context?{'X-Observanda-Workspace':context}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})})};}
 const one=await client(app),created=await one.request('/api/notebook/create',{title:'Secure by default',storagePath:root});assert.equal(created.status,201);const result=await created.json();one.setContext(result.storage.contextId);
 assert.equal(result.access.encrypted,true);assert.equal(result.access.deviceAuthorized,true);
 const dashboard=await (await one.request('/api/dashboard')).json();dashboard.settings.views[0].name='Private dashboard sentinel';
 assert.equal((await one.request('/api/dashboard',{settings:dashboard.settings,etag:dashboard.etag})).status,200);
 await assertPrivateCatalogue(root,'Private dashboard sentinel');
 const info=await (await one.request('/api/security/workspace')).json();
 const recovered=await (await one.request('/api/security/workspace',{action:'recovery',etag:info.etag,confirmed:true})).json();assert.ok(recovered.recovery);
 assert.equal((await one.request('/api/access/lock',{})).status,200);assert.equal((await one.request('/api/notebook')).status,401);
 const newSession=await client(app);assert.equal((await newSession.request('/api/notebook')).status,401);
 assert.equal((await one.request('/api/access/unlock',{})).status,200);
 const outsider=await startServer({root,port:0,deviceStore:b});t.after(()=>outsider.close());const two=await client(outsider);
 assert.equal((await two.request('/api/notebook')).status,401);assert.equal((await two.request('/api/security/device',{})).status,200);
 assert.equal((await two.request('/api/access/unlock',{recovery:recovered.recovery})).status,200);
 assert.equal((await two.request('/api/notebook')).status,200);
 const newPassword='recovered synthetic passphrase';
 assert.equal((await two.request('/api/access/change',{username:'',password:newPassword})).status,200);
 assert.equal((await two.request('/api/access/lock',{})).status,200);
 assert.equal((await two.request('/api/access/unlock',{password:newPassword})).status,200);
 // A device auto-unlock already in flight must not undo a later manual lock.
 let entered,release;
 const enteredPromise=new Promise(r=>entered=r),released=new Promise(r=>release=r),original=a.protector.unprotect;
 a.protector.unprotect=async bytes=>{entered();await released;return original(bytes);};
 const pending=client(app);await enteredPromise;
 assert.equal((await one.request('/api/access/lock',{})).status,200);
 release();const late=await pending;
 assert.equal((await late.request('/api/notebook')).status,401);
});
