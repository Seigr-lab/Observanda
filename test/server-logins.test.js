import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {buildPublication} from '../src/publication.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {Publisher,defaultPublishing,readRemoteFiles} from '../src/publishing.js';
import {ServerLogins,validServerLogin} from '../src/server-logins.js';
import {serverLoginRequest} from '../src/server-login-requests.js';
import {HostCredentials} from '../src/host-credentials.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {memoryHost} from './remote-host-fixture.js';

async function setup(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-server-logins-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const credentials=new HostCredentials({file:path.join(directory,'computer.host-credentials.json'),deviceStore:{available:()=>false}});
 return {directory,workspace:f.workspace,credentials};
}
const ftpLogin={name:'Shared hosting',protocol:'ftp',host:'shared.example',port:21,user:'account',security:'explicit'};

test('server logins are set up once for the workspace, hold no secrets, and refuse unsafe values',async t=>{
 const s=await setup(t),logins=new ServerLogins(s.workspace);
 assert.deepEqual(await logins.read(),{logins:[],etag:'new'});
 let saved=await logins.save(ftpLogin,'new');const id=saved.logins[0].id;
 assert.equal(saved.logins.length,1);assert.equal(validServerLogin(saved.logins[0]),true);
 saved=await logins.save({...saved.logins[0],name:'Shared hosting (main)'},saved.etag);assert.equal(saved.logins[0].id,id);assert.equal(saved.logins[0].name,'Shared hosting (main)');
 await assert.rejects(logins.save(ftpLogin,'new'),{code:'PUBLISH_STALE'});
 for(const bad of [{...ftpLogin,password:'x'},{...ftpLogin,security:'tls'},{...ftpLogin,host:'-oProxy'},{...ftpLogin,protocol:'ssh',identityFile:'',security:undefined},{...ftpLogin,name:' '},{...ftpLogin,id:'x'}])await assert.rejects(logins.save(bad,saved.etag),{code:'PUBLISH_CONFIG'},JSON.stringify(bad));
 await assert.rejects(logins.save({...ftpLogin,id:randomUUID()},saved.etag),{code:'PUBLISH_LOGIN'});
 // The password of an FTP login is entered once on this computer and never returned.
 let listed=await serverLoginRequest('password',{id,password:'host secret'},{workspace:s.workspace,hostCredentials:s.credentials});
 assert.deepEqual(listed.logins[0].password,{saved:true,persistent:false});assert.equal(JSON.stringify(listed).includes('host secret'),false);
 assert.equal(JSON.stringify(await s.workspace.readMetadata('.observanda/server-logins.json',65536)).includes('host secret'),false);
 listed=await serverLoginRequest('password-forget',{id},{workspace:s.workspace,hostCredentials:s.credentials});assert.deepEqual(listed.logins[0].password,{saved:false,persistent:false});
 listed=await serverLoginRequest('remove',{id,etag:listed.etag},{workspace:s.workspace,hostCredentials:s.credentials});assert.deepEqual(listed.logins,[]);
});

test('websites share one server login with their own folders, records and file ownership',async t=>{
 const s=await setup(t),host=memoryHost(),passwords=[];
 const ftp={open:async(c,options)=>{passwords.push(options.password);return host.transport.open(c,options);}};
 const {logins:[login],etag}=await new ServerLogins(s.workspace).save(ftpLogin,'new');
 await serverLoginRequest('password',{id:login.id,password:'host secret'},{workspace:s.workspace,hostCredentials:s.credentials});
 const site=async(id,folder)=>{
  const workspace=websiteWorkspace(s.workspace,id),publisher=new Publisher(s.workspace.root,{workspace,ftp,hostCredentials:s.credentials,authorizeCandidate:async()=>{}},s.workspace.vault),config=defaultPublishing();
  config.kind='ftp';config.ftp={login:login.id,directory:folder,allowExisting:false};const saved=await publisher.save(config,'new');
  return {publisher,saved};
 };
 const first=await site(randomUUID(),'/public_html/atlas'),second=await site(randomUUID(),'/public_html/diary');
 assert.equal(first.saved.server.name,'Shared hosting');assert.deepEqual(first.saved.server.password,{saved:true,persistent:false});
 assert.notEqual(first.publisher.destinationKey(first.saved.config),second.publisher.destinationKey(second.saved.config));
 const book=sampleNotebook(),atlas=buildPublication(book),diary=buildPublication({...structuredClone(book),title:'Bee yard diary'});
 await first.publisher.deploy(atlas,first.saved.etag,randomUUID());await second.publisher.deploy(diary,second.saved.etag,randomUUID());
 assert.ok(host.files.has('/public_html/atlas/index.html'));assert.ok(host.files.has('/public_html/diary/index.html'));
 assert.deepEqual(passwords,['host secret','host secret']);
 const record=async p=>readRemoteFiles(p.publisher.workspace,(await p.publisher.read()).receipt&&p.publisher.remoteRecordKey(p.saved.config,await p.publisher.serverDestination(p.saved.config)));
 assert.equal(Object.keys(await record(first)).length,atlas.files.size);assert.equal(Object.keys(await record(second)).length,diary.files.size);
 // A login edited to another server is a new destination for every website using it.
 const moved=await new ServerLogins(s.workspace).save({...login,host:'new-host.example'},etag);
 assert.notEqual(first.publisher.remoteRecordKey(first.saved.config,await first.publisher.serverDestination(first.saved.config)),first.publisher.remoteRecordKey(first.saved.config,{...login,directory:'/public_html/atlas'}));
 // A removed login makes each website ask for a login again.
 await new ServerLogins(s.workspace).remove(login.id,moved.etag);
 assert.deepEqual((await first.publisher.read()).server,{missing:true});
 await assert.rejects(first.publisher.deploy(atlas,first.saved.etag,randomUUID()),{code:'PUBLISH_LOGIN'});
});
