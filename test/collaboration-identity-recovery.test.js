import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {TestDeviceStore} from './device-fixture.js';
import {CollaborationRecovery} from '../src/collaboration/identity-recovery.js';
import {OrganizationIdentity,verifyOrganizationCommand} from '../src/collaboration/identity.js';
import {ExchangeIdentity,wrapExchangeKey} from '../src/collaboration/exchange-identity.js';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {Workspace} from '../src/storage.js';
const password='Synthetic identity backup password';

async function interruptRecovery(t,device,file,expected,verified){
 const source=`import {CollaborationRecovery} from ${JSON.stringify(new URL('../src/collaboration/identity-recovery.js',import.meta.url).href)};
 import {TestDeviceStore} from ${JSON.stringify(new URL('./device-fixture.js',import.meta.url).href)};
 let text='';for await(const part of process.stdin)text+=part;const input=JSON.parse(text),device=new TestDeviceStore({file:process.argv[1]}),protector=device.protector;let count=0;
 device.protector={available:()=>true,unprotect:bytes=>protector.unprotect(bytes),protect:async bytes=>{if(++count===2){process.stdout.write('ready');setInterval(()=>{},1000);await new Promise(()=>{});}return protector.protect(bytes);}};
 await new CollaborationRecovery(device).restore(input.file,input.password,input.expected,input.verified);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,device.file],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);child.stdin.on('error',()=>{});const exited=new Promise(resolve=>child.once('exit',resolve));
 t.after(async()=>{child.kill();await exited;});child.stdin.end(JSON.stringify({file,password,expected,verified}));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Recovery did not reach interruption point: '+stderr)),15000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Recovery child exited before interruption: '+stderr));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
 child.kill();await exited;
}

async function devices(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-identity-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:5}));return ['source','target'].map(name=>new TestDeviceStore({file:path.join(directory,name)}));}
test('portable recovery restores both keys, preserves former identities and rejects invalid files without changing access keys',async t=>{
 const [source,target]=await devices(t),a=new CollaborationRecovery(source),b=new CollaborationRecovery(target),signer=new OrganizationIdentity(source),recipient=new ExchangeIdentity(source);
 const original=await signer.public(),contact=await recipient.contact(),device=await target.identity(),previous=await new ExchangeIdentity(target).contact(),before=await b.state();
 const originalFiles=await Promise.all([target.file,target.file+'.organization-signing',target.file+'.organization-encryption'].map(f=>readFile(f))),exported=await a.backup(password,password);
 assert.equal(exported.identity.signing.id,original.id);assert.equal(exported.identity.encryption.id,contact.value.encryption.id);
 assert.ok(!JSON.stringify(exported.file).includes(original.publicKey));assert.ok(!JSON.stringify(exported.file).includes(password));
 for(const file of [{...exported.file,format:'unknown'},{...exported.file,kdf:'expensive'},{...exported.file,salt:randomBytes(32).toString('base64')},{...exported.file,content:exported.file.content.slice(1)}, {...exported.file,unexpected:true}])await assert.rejects(b.inspect(file,password),{code:'COLLABORATION_IDENTITY_FILE'});
 await assert.rejects(b.inspect(exported.file,'A wrong password with enough length'),{code:'COLLABORATION_IDENTITY_FILE'});
 await assert.rejects(a.backup('short','short'),{code:'COLLABORATION_IDENTITY_PASSWORD'});await assert.rejects(a.backup(password,password+'?'),{code:'COLLABORATION_IDENTITY_PASSWORD'});
 const review=await b.inspect(exported.file,password);assert.deepEqual(review.state,before);assert.equal(review.identity.signing.id,original.id);
 await assert.rejects(b.restore(exported.file,password,before.etag,'0'.repeat(64)),{code:'COLLABORATION_VERIFY'});assert.deepEqual(await b.state(),before);
 await interruptRecovery(t,target,exported.file,before.etag,review.identity.id);assert.deepEqual(await b.state(),before);
 const protector=target.protector;let writes=0;target.protector={available:()=>true,unprotect:bytes=>protector.unprotect(bytes),protect:bytes=>{if(++writes===2)throw Error('Synthetic protection failure');return protector.protect(bytes);}};
 try{await assert.rejects(b.restore(exported.file,password,before.etag,review.identity.id),/Synthetic protection/);}finally{target.protector=protector;}
 assert.deepEqual(await b.state(),before);
 const restored=await b.restore(exported.file,password,before.etag,review.identity.id);assert.equal(restored.current.signing.id,original.id);assert.equal(restored.current.encryption.id,contact.value.encryption.id);assert.equal(restored.saved.length,2);
 assert.deepEqual(await b.restore(exported.file,password,before.etag,review.identity.id),restored); // lost response
 assert.deepEqual(await target.identity(),device);assert.deepEqual(await Promise.all([target.file,target.file+'.organization-signing',target.file+'.organization-encryption'].map(f=>readFile(f))),originalFiles);
 const command=await new OrganizationIdentity(target).sign({meaning:'After device replacement'});assert.deepEqual(verifyOrganizationCommand(command),command.value);assert.equal(command.identity.id,original.id);
 const id=randomUUID(),key=randomBytes(32),wrapped=wrapExchangeKey(contact,id,key);
 assert.deepEqual(await new ExchangeIdentity(target).unwrap({id,key:wrapped,recipient:contact.value.encryption.id}),key);key.fill(0);
 const old=await b.activate(null,restored.etag);assert.equal(old.current.signing.id,previous.identity.id);assert.equal(old.current.encryption.id,previous.value.encryption.id);
 assert.deepEqual(await b.activate(null,restored.etag),old); // lost activation response
 await assert.rejects(b.activate(restored.active,restored.etag),{code:'COLLABORATION_IDENTITY_CHANGED'});
 await b.activate(restored.active,old.etag);assert.equal((await new OrganizationIdentity(target).public()).id,original.id);
 const store=JSON.parse(await readFile(b.store.file,'utf8'));store.pairs[0].signing.protectedKey=Buffer.from('Corrupt protected key').toString('base64');await writeFile(b.store.file,JSON.stringify(store));
 const damaged=await b.state();await assert.rejects(new OrganizationIdentity(target).sign({meaning:'Must not sign with damaged key'}));
 await assert.rejects(b.restore(exported.file,password,old.etag,review.identity.id),{code:'COLLABORATION_IDENTITY_CHANGED'});
 await b.restore(exported.file,password,damaged.etag,review.identity.id);assert.equal((await new OrganizationIdentity(target).sign({meaning:'Repaired'})).identity.id,original.id);
});

test('recovering a member identity retains current scoped permission and never overrides revocation or unlocks the workspace',async t=>{
 const f=await collaborationFixture(t),replacement=new TestDeviceStore({file:path.join(f.directory,'replacement-key')}),source=new CollaborationRecovery(f.member.deviceStore),target=new CollaborationRecovery(replacement),backup=await source.backup(password,password),state=await target.state();
 await target.restore(backup.file,password,state.etag,backup.identity.id);
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());const client=new LiveClient(replacement,await host.card(f.grant.id));t.after(()=>client.close());
 const before=await f.author.workspace.read(),authority=await f.state();assert.equal((await client.call('list')).records.length,2);
 await assert.rejects(client.call('read',{recordId:f.book.entries[2].id}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(new Workspace(f.author.workspace.root).outline(),{code:'ACCESS_LOCKED'});
 assert.deepEqual(await f.author.workspace.read(),before);assert.deepEqual(await f.state(),authority);
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,active:false});
 await target.restore(backup.file,password,state.etag,backup.identity.id);await assert.rejects(client.call('list'),{code:'COLLABORATION_DENIED'});
});
