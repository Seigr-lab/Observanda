import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {UserProfile} from '../src/user-profile.js';
import {TestDeviceStore} from './device-fixture.js';
import {OrganizationIdentity} from '../src/collaboration/identity.js';
import {exchangeContact} from '../src/collaboration/exchange-identity.js';
import {CollaborationRecovery} from '../src/collaboration/identity-recovery.js';
import {emptyUserProfile,observandaUserId,validUserProfile} from '../src/web/user-profile-model.js';

async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-profile-'));t.after(()=>rm(directory,{recursive:true,force:true}));const device=new TestDeviceStore({file:path.join(directory,'device')});return {directory,device,profiles:new UserProfile(device)};}
const profile=()=>({...emptyUserProfile(),username:'synthetic-researcher',name:'Synthetic Researcher',email:'synthetic@example.test',identifiers:[{id:randomUUID(),label:'GitHub',value:'synthetic-user',url:'https://github.com/synthetic-user'},{id:randomUUID(),label:'DOI',value:'10.0000/example',url:''},{id:randomUUID(),label:'Custom laboratory directory',value:'0006',url:''}]});

test('profile edits preserve the sharing identity, protect details and reject stale or malformed writes',async t=>{
 const f=await fixture(t),initial=await f.profiles.state(),signer=await new OrganizationIdentity(f.device).public();assert.equal(initial.userId,observandaUserId(signer.id));assert.equal(initial.etag,null);
 const command={userId:initial.userId,expected:initial.etag,profile:profile()},saved=await f.profiles.save(command);
 assert.deepEqual((await new UserProfile(f.device).state()),saved);assert.equal(saved.userId,initial.userId);
 const bytes=await readFile(f.profiles.file(signer));assert.ok(!bytes.includes(Buffer.from(command.profile.email)));assert.ok(!bytes.includes(Buffer.from(command.profile.name)));
 await assert.rejects(f.profiles.save({...command,profile:{...command.profile,name:'Other editor'}}),{code:'USER_PROFILE_CHANGED'});
 const contact=await f.profiles.contact(saved.userId);exchangeContact(contact.contact);assert.equal(contact.contact.identity.id,signer.id);assert.equal(contact.userId,initial.userId);assert.ok(!JSON.stringify(contact).includes(command.profile.email));
 for(const change of [{userId:'observanda:user:'+'0'.repeat(64)},{profile:{...profile(),identifiers:[{id:randomUUID(),label:'Link',value:'bad',url:'javascript:alert(1)'}]}},{profile:{...profile(),password:'secret'}},{profile:{...profile(),email:'missing-domain'}},{profile:{...profile(),identifiers:[{id:randomUUID(),label:'',value:'001',url:''}]}}]){
  await assert.rejects(async()=>f.profiles.save({...command,expected:saved.etag,...change}),error=>['USER_PROFILE_INVALID','USER_PROFILE_CHANGED'].includes(error.code));
  assert.deepEqual(await f.profiles.state(),saved);
 }
 const concurrent=await Promise.allSettled([f.profiles.save({userId:saved.userId,expected:saved.etag,profile:{...saved.profile,name:'A'}}),f.profiles.save({userId:saved.userId,expected:saved.etag,profile:{...saved.profile,name:'B'}})]);
 assert.equal(concurrent.filter(v=>v.status==='fulfilled').length,1);assert.equal(concurrent.find(v=>v.status==='rejected').reason.code,'USER_PROFILE_CHANGED');
 const corrupt=JSON.parse(await readFile(f.profiles.file(signer),'utf8'));corrupt.tag=Buffer.alloc(16).toString('base64');await writeFile(f.profiles.file(signer),JSON.stringify(corrupt));
 await assert.rejects(f.profiles.state(),{code:'USER_PROFILE_DAMAGED'});await assert.rejects(f.profiles.save({userId:saved.userId,expected:saved.etag,profile:saved.profile}),{code:'USER_PROFILE_DAMAGED'});
 assert.deepEqual(JSON.parse(await readFile(f.profiles.file(signer),'utf8')),corrupt);
});

test('large extensible profiles wrap only a small key with the operating system protector',async t=>{
 const f=await fixture(t),initial=await f.profiles.state(),value=profile();value.identifiers=Array.from({length:40},(_,i)=>({id:randomUUID(),label:'Domain '+i,value:'x'.repeat(1100),url:''}));assert.ok(validUserProfile(value));
 const protect=f.device.protector.protect.bind(f.device.protector);t.mock.method(f.device.protector,'protect',bytes=>{assert.equal(bytes.length,32);return protect(bytes);});
 const saved=await f.profiles.save({userId:initial.userId,expected:null,profile:value});assert.deepEqual(await f.profiles.state(),saved);
});

test('identity recovery preserves a user ID across installations and keeps local profiles separated',async t=>{
 const f=await fixture(t),other=new TestDeviceStore({file:path.join(f.directory,'other-device')}),destination=new UserProfile(other),password='Synthetic identity recovery password';
 const original=await f.profiles.state(),saved=await f.profiles.save({userId:original.userId,expected:null,profile:profile()}),prior=await destination.state();assert.notEqual(prior.userId,saved.userId);
 const local=await destination.save({userId:prior.userId,expected:null,profile:{...profile(),name:'Other person'}});
 const backup=await new CollaborationRecovery(f.device).backup(password,password),recovery=new CollaborationRecovery(other),before=await recovery.state();
 await recovery.restore(backup.file,password,before.etag,backup.identity.id);
 const recovered=await destination.state();assert.equal(recovered.userId,saved.userId);assert.deepEqual(recovered.profile,emptyUserProfile());
 await assert.rejects(destination.save({userId:local.userId,expected:local.etag,profile:local.profile}),{code:'USER_PROFILE_CHANGED'});
 await recovery.activate(null,(await recovery.state()).etag);assert.deepEqual(await destination.state(),local);
 assert.deepEqual(await f.profiles.state(),saved);
});
