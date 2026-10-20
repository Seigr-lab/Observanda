import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {githubFixture} from './github-fixture.js';
import {sshFixture} from './ssh-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {PublicationSourceAccess} from '../src/publication-source-access.js';
import {publicationSourceFactory} from '../src/project-publication-sources.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {clearVault} from '../src/encryption.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication} from '../src/project-application.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import githubMessages from '../src/web/locales/en/githubTransfer.json' with {type:'json'};
import {publicationText} from '../src/web/publication-messages.js';

async function run(queue,onProgress=async()=>{}){
 const job=await queue.claim();assert.ok(job);let pulse=Promise.resolve();
 const refresh=value=>{pulse=pulse.then(()=>queue.pulse(job.id,job.lease.token,value));return pulse;};
 const heartbeat=setInterval(()=>{void refresh().catch(()=>{});},Math.max(100,queue.leaseMs/3));heartbeat.unref();
 try{const output=await queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:async value=>{await onProgress(value);await refresh(value);}});clearInterval(heartbeat);await pulse;return await queue.complete(job.id,job.lease.token,output);}
 catch(error){clearInterval(heartbeat);await pulse.catch(()=>{});return queue.release(job.id,job.lease.token,{error});}
}
const writes=remote=>remote.calls.filter(call=>call.method!=='GET');
const activates=call=>call.route.endsWith('/git/refs')||call.method==='PATCH'&&call.route.includes('/git/refs/heads/');
function sourceBook(){const book=sampleNotebook();book.entries=[{...book.entries[0],sections:[],attachments:[],relations:[],figures:[]}];return book;}
async function changeSource(workspace,patch){
 const {book}=await workspace.read(),record=book.entries[0];
 await new ResearchRecords(workspace,new MediaStore(workspace)).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,...patch}}]});
}
async function fixture(t,{ssh=false,pages=false,foreign=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-deployment-consent-')),book=sourceBook(),keys=[];let runtime,detach,application,jobs;
 t.after(async()=>{await jobs?.worker.stop();await application?.close();await runtime?.close();detach?.();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-deployment-consent-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 if(foreign){book.title=book.projects[0].title='Source project';runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(runtime);}
 const host=foreign?{...sampleNotebook(),entries:[],projects:[],notebooks:[]}:book;
 if(foreign)host.website.researchSources=[{workspaceId:book.id,projectIds:[book.projects[0].id],selection:{defaultShare:false,includeProjects:[book.projects[0].id],records:[]}}];
 const f=await encryptedFixture(directory,host);keys.push(f.vault);let source=f.workspace,sourceReader;
 if(foreign){
  const access=await createWorkspaceAccess('','Source password',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  source=await initializeProjectLocation(path.join(f.workspace.root,'Source project'),book.projects[0].id,book,access,vault);
  const registry=new ProjectRegistry(f.workspace,host.id);await registry.attach(source,{expected:(await registry.read()).revision});
  application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});const client={};await application.unlock(client,book.projects[0].id,{password:'Source password'});sourceReader=publicationSourceFactory(application,client,f.workspace);
 }
 const remote=ssh?await sshFixture(t):githubFixture(),publisher=new Publisher(f.workspace.root,ssh?{ssh:remote.host}:{request:remote.request},f.vault),config=defaultPublishing();
 if(ssh){config.kind='ssh';config.ssh=remote.config;}else Object.assign(config.github,{owner:'example',repository:'notebook',branch:'observanda-site',pages});
 config.publicUrl='https://public.example/research/';const saved=await publisher.save(config,'new');if(!ssh)await publisher.connect('synthetic_github_token_1234567890');
 const grants=new PublicationSourceAccess();jobs=workspaceJobs(f.workspace,publisher,{sourceAccess:grants});
 const releases=new PublicationJobs(f.workspace,{sourceReader}),candidate=await releases.inline(await releases.workspace.outline());
 const deployments=new DeploymentJobs(f.workspace,publisher,jobs.queue,{sourceReader,sourceAccess:grants}),job=await deployments.start({id:candidate.reviewId,configEtag:saved.etag,reviewed:true});
 return {...f,...jobs,remote,publisher,source,grants,releases,candidate,deployments,job};
}

test('a deployment worker takes foreign-source access before reading its retained edition and permits later text edits',async t=>{
 const f=await fixture(t,{foreign:true});let edited=false;
 f.remote.setHook(async(call,phase)=>{if(!edited&&phase==='after'&&call.route.endsWith('/git/blobs')){edited=true;await changeSource(f.source,{body:'Ordinary later research text.'});}});
 const result=await run(f.queue);assert.equal(result.state,'completed',result.error);assert.equal(edited,true);assert.equal(f.grants.take(f.job.id),undefined);assert.equal(f.remote.calls.filter(activates).length,1);
 assert.equal((await f.deployments.read(f.job.id)).journal.receipt.status,'uploaded-repository-only');
});

test('withdrawal after one uploaded blob stops further GitHub content writes',async t=>{
 const f=await fixture(t);let withdrawn=false;
 f.remote.setHook(async(call,phase)=>{if(!withdrawn&&phase==='after'&&call.route.endsWith('/git/blobs')){withdrawn=true;await changeSource(f.source,{share:false});}});
 const result=await run(f.queue);assert.equal(result.state,'failed');assert.equal(result.error,'PUBLICATION_PERMISSIONS_CHANGED');assert.equal(withdrawn,true);
 assert.equal(writes(f.remote).length,1);assert.equal(f.remote.head,null);assert.equal((await f.deployments.read(f.job.id)).journal.receipt,undefined);
});

test('an uncertain GitHub intent never authorizes activation after consent was withdrawn',async t=>{
 const f=await fixture(t);let withdrawn=false;
 const result=await run(f.queue,async value=>{if(!withdrawn&&value.stage===githubMessages.pushing){withdrawn=true;await changeSource(f.source,{share:false});}});
 assert.equal(withdrawn,true);assert.equal(result.error,'PUBLICATION_PERMISSIONS_CHANGED');assert.equal((await f.deployments.read(f.job.id)).journal.pushAttempted,true);assert.equal(f.remote.head,null);
 const count=writes(f.remote).length;await f.deployments.control(f.job.id,'retry');const retried=await run(f.queue);
 assert.equal(retried.error,'PUBLICATION_PERMISSIONS_CHANGED');assert.equal(writes(f.remote).length,count);assert.equal(f.remote.head,null);
 await assert.rejects(f.releases.read(f.candidate.reviewId),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
});

for(const lostReply of [false,true])test(`GitHub retains the activation receipt after withdrawal${lostReply?' and a lost response':''}`,async t=>{
 const f=await fixture(t);let withdrawn=false;
 f.remote.setHook(async(call,phase)=>{if(!withdrawn&&phase==='after'&&activates(call)){withdrawn=true;await changeSource(f.source,{share:false});if(lostReply)throw Error('Synthetic lost activation response');}});
 let result=await run(f.queue);assert.equal(withdrawn,true);assert.equal(f.remote.head,(await f.deployments.read(f.job.id)).journal.commit);
 if(lostReply){assert.equal(result.state,'failed');assert.equal((await f.deployments.read(f.job.id)).journal.receipt,undefined);const count=writes(f.remote).length;await f.deployments.control(f.job.id,'retry');result=await run(f.queue);assert.equal(writes(f.remote).length,count);}
 assert.equal(result.state,'completed',result.error);const receipt=(await f.deployments.read(f.job.id)).journal.receipt;assert.equal(receipt.commit,f.remote.head);assert.equal(receipt.status,'uploaded-repository-only');assert.equal((await f.publisher.read()).receipt.commit,f.remote.head);
 await assert.rejects(f.releases.read(f.candidate.reviewId),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
});

test('withdrawal after GitHub activation retains its receipt but prevents a new Pages configuration write',async t=>{
 const f=await fixture(t,{pages:true});let withdrawn=false;
 f.remote.setHook(async(call,phase)=>{if(!withdrawn&&phase==='after'&&activates(call)){withdrawn=true;await changeSource(f.source,{share:false});}});
 const result=await run(f.queue);assert.equal(result.error,'PUBLICATION_PERMISSIONS_CHANGED');assert.equal(withdrawn,true);
 assert.equal((await f.deployments.read(f.job.id)).journal.receipt.commit,f.remote.head);assert.equal(f.remote.calls.filter(call=>call.route.endsWith('/pages')&&call.method!=='GET').length,0);
});

test('SSH checks consent at the final switch and cannot reuse an uncertain intent to activate',async t=>{
 const f=await fixture(t,{ssh:true});let withdrawn=false;
 const result=await run(f.queue,async value=>{if(!withdrawn&&value.stage===publicationText('sshSwitch')){withdrawn=true;await changeSource(f.source,{share:false});}});
 assert.equal(withdrawn,true);assert.equal(result.error,'PUBLICATION_PERMISSIONS_CHANGED');assert.equal((await f.deployments.read(f.job.id)).journal.pushAttempted,true);
 assert.equal(f.remote.calls.filter(call=>call.program==='ssh'&&call.args.at(-1).includes('mv -Tf')).length,0);const uploads=f.remote.calls.filter(call=>call.program==='sftp').length;
 await f.deployments.control(f.job.id,'retry');const retried=await run(f.queue);assert.equal(retried.error,'PUBLICATION_PERMISSIONS_CHANGED');assert.equal(f.remote.calls.filter(call=>call.program==='sftp').length,uploads);
 assert.equal(f.remote.calls.filter(call=>call.program==='ssh'&&call.args.at(-1).includes('mv -Tf')).length,0);
});

for(const lostReply of [false,true])test(`SSH retains its verified activation receipt after withdrawal${lostReply?' and a lost response':''}`,async t=>{
 const f=await fixture(t,{ssh:true});let withdrawn=false;
 f.remote.setHook(async(call,phase)=>{if(!withdrawn&&phase==='after'&&call.program==='ssh'&&call.args.at(-1).includes('mv -Tf')){withdrawn=true;await changeSource(f.source,{share:false});if(lostReply)throw Error('Synthetic lost switch response');}});
 let result=await run(f.queue);assert.equal(withdrawn,true);assert.equal((await f.remote.current()).split(path.sep).join('/'),'releases/'+f.candidate.id);
 if(lostReply){assert.equal(result.state,'failed');assert.equal((await f.deployments.read(f.job.id)).journal.receipt,undefined);const uploads=f.remote.calls.filter(call=>call.program==='sftp').length;await f.deployments.control(f.job.id,'retry');result=await run(f.queue);assert.equal(f.remote.calls.filter(call=>call.program==='sftp').length,uploads);}
 assert.equal(result.state,'completed',result.error);const journal=(await f.deployments.read(f.job.id)).journal;assert.equal(journal.receipt.commit,f.candidate.id);assert.equal(journal.receipt.status,'uploaded-remote-verified');assert.equal(journal.released,true);assert.equal((await f.publisher.read()).receipt.commit,f.candidate.id);
 await assert.rejects(f.releases.read(f.candidate.reviewId),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
});
