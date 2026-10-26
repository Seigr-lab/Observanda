import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {projectJobOwner,projectPublicationJobs} from '../src/project-job-ownership.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {websiteDocument} from '../src/web/website-sites-model.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {clearVault} from '../src/encryption.js';

test('publication job owners distinguish named workspace sites from selected and foreign projects',async()=>{
 const namespaceId=randomUUID(),projectId=randomUUID(),otherProjectId=randomUUID(),workspaceSite=randomUUID(),projectSite=randomUUID(),otherSite=randomUUID(),sites=new Map([
  [workspaceSite,{id:workspaceSite,projectId:null,ambiguous:false}],
  [projectSite,{id:projectSite,projectId,ambiguous:false}],
  [otherSite,{id:otherSite,projectId:otherProjectId,ambiguous:false}]
 ]),owner=projectJobOwner({},{namespaceId,projectId,website:async id=>sites.get(id)});
 for(const type of projectPublicationJobs){
  const job=websiteId=>({type,scope:namespaceId,input:{websiteId}});
  assert.deepEqual(await owner(job(null)),{kind:'workspace',selected:false});
  assert.deepEqual(await owner(job(workspaceSite)),{...sites.get(workspaceSite),kind:'workspace',selected:false});
  assert.deepEqual(await owner(job(projectSite)),{...sites.get(projectSite),kind:'project',selected:true});
  assert.deepEqual(await owner(job(otherSite)),{...sites.get(otherSite),kind:'project',selected:false});
  await assert.rejects(owner({...job(workspaceSite),scope:randomUUID()}),{code:'JOB_DAMAGED'});
  await assert.rejects(owner(job(randomUUID())),{code:'PROJECT_MIGRATION_OWNERSHIP'});
  await assert.rejects(owner(job('')),{code:'JOB_DAMAGED'});
  for(const invalid of [{id:workspaceSite,projectId:null,ambiguous:true},{id:randomUUID(),projectId:null,ambiguous:false},{id:workspaceSite,projectId:undefined,ambiguous:false},{id:workspaceSite,projectId:'foreign',ambiguous:false}]){
   sites.set(workspaceSite,invalid);await assert.rejects(owner(job(workspaceSite)),{code:'PROJECT_MIGRATION_OWNERSHIP'});
  }
  sites.set(workspaceSite,{id:workspaceSite,projectId:null,ambiguous:false});
 }
});

test('named workspace publication jobs remain writable under source authority while retired project jobs are fenced',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-job-owner-')),book=sampleNotebook(),projectId=book.projects[0].id,projectSiteId=randomUUID(),named={id:randomUUID()};
 book.websites=[{id:projectSiteId,name:'Retained project website',projectId},{id:named.id,name:'Independent publication',projectId:null}].map(site=>({...site,document:websiteDocument(book),projects:[{id:projectId,share:true,logoId:null}],selection:{defaultShare:false,includeProjects:[projectId],records:[]}}));
 const f=await encryptedFixture(directory,book),jobs=workspaceJobs(f.workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const active='project-source-authority:active';
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('INSERT INTO state VALUES ($1,$2)',active,store.encode('state',active,{version:1}))));
 const enqueue=async id=>{const workspace=websiteWorkspace(f.workspace,id);return new PublicationJobs(workspace).start(await workspace.outline(),websiteJobQueue(jobs.queue,id));};
 const independent=await enqueue(named.id),scoped=await enqueue(projectSiteId);
 assert.equal(independent.state,'queued');assert.equal(independent.input.websiteId,named.id);
 assert.equal(scoped.state,'queued');assert.equal(scoped.input.websiteId,projectSiteId);
 assert.equal((await jobs.queue.control(independent.id,'cancel')).state,'cancelled');
 assert.equal((await jobs.queue.control(scoped.id,'cancel')).state,'cancelled');
 const slot='project-source-authority:project:'+projectId;
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const receipt={version:1,operationId:randomUUID(),projectId,sourceNamespace:book.id,namespaceId:randomUUID(),vaultId:randomUUID(),sourceHead:await store.head()};
  await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,receipt));
 }));
 assert.equal((await jobs.queue.control(independent.id,'retry')).state,'queued');
 await assert.rejects(jobs.queue.control(scoped.id,'retry'),{code:'PROJECT_RELOCATED'});
 assert.equal((await jobs.queue.read(scoped.id)).state,'cancelled','Rejected project retry rolls back its queue and job writes');
 assert.equal((await jobs.queue.read(independent.id)).state,'queued');
 assert.equal((await jobs.queue.control(independent.id,'cancel')).state,'cancelled');
});
