import {githubFixture} from './github-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {publicationSource} from '../src/publication-source.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {PublicationRollback} from '../src/publication-rollback.js';
import {LocalExport} from '../src/local-export.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';

const edit=site=>({workspaceId:site.book.id,baseEtag:site.etag,metadata:{},projects:[],changes:[],removed:[],selection:site.site.selection});

test('another website edit preserves preparation, export, deployment admission and rollback review without admitting changed publication inputs',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-freshness-'));let fixture,jobs;
 try{
  const book=createNotebook('Publishing workspace');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Field journal','Course website'])ids.push((await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  const initial=await sites.read(ids[0]),intro=edit(initial);intro.metadata.website={...initial.book.website,home:{...initial.book.website.home,enabled:true,introduction:'Synthetic publication introduction'}};await sites.save(ids[0],intro);
  const workspace=websiteWorkspace(fixture.workspace,ids[0]),publisher=new Publisher(workspace.root,{workspace,request:()=>{throw Error('Unexpected provider call');}},workspace.vault),config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'field-journal'});
  const destination=await publisher.save(config,'new');jobs=workspaceJobs(fixture.workspace,publisher);const queue=websiteJobQueue(jobs.queue,ids[0]),releases=new PublicationJobs(workspace),etag=(await workspace.outline()).etag,candidate=await releases.inline({etag});
  const rollback=new PublicationRollback(workspace,publisher),approval=await rollback.review({id:candidate.reviewId});
  async function change(id,footer){const site=await sites.read(id),command=edit(site);command.metadata.website={...site.book.website,footer};await sites.save(id,command);}
  await change(ids[1],'Unrelated course footer');
  assert.equal((await publicationSource(workspace,{etag})).website.title,'Field journal');
  const another=await releases.inline({etag});assert.equal(another.websiteId,ids[0]);assert.equal((await rollback.authorize(candidate,approval.review.id)).id,approval.review.id);
  const output=path.join(directory,'published');await mkdir(output);const exporter=new LocalExport(workspace),plan=await exporter.plan({reviewId:candidate.reviewId,directory:output});await exporter.apply({id:plan.id,reviewed:true});
  assert.match(await readFile(path.join(output,candidate.defaultPage),'utf8'),/Field journal/);
  const deployments=new DeploymentJobs(workspace,publisher,queue),intent={id:candidate.reviewId,configEtag:destination.etag,reviewed:true};
  const changed=await publisher.save({...config,github:{...config.github,repository:'changed-destination'}},destination.etag);
  await assert.rejects(deployments.start(intent),{code:'PUBLISH_STALE'});await assert.rejects(deployments.start({...intent,configEtag:changed.etag}),{code:'PUBLISH_STALE'});
  await assert.rejects(publisher.deploy(candidate,destination.etag,book.id),{code:'PUBLISH_STALE'});await assert.rejects(rollback.authorize(candidate,approval.review.id),{code:'PUBLISH_STALE'});
  assert.equal((await publisher.save(config,changed.etag)).etag,destination.etag);
  const job=await deployments.start(intent);assert.equal(job.state,'queued');
  await change(ids[0],'Changed journal footer');
  await assert.rejects(publicationSource(workspace,{etag}),{code:'CONFLICT'});await assert.rejects(releases.inline({etag}),{code:'CONFLICT'});
  await assert.rejects(exporter.candidate(candidate.reviewId,{fresh:true}),{code:'PUBLISH_STALE'});await assert.rejects(deployments.start(intent),{code:'STALE'});await assert.rejects(rollback.authorize(candidate,approval.review.id),{code:'PUBLISH_STALE'});
 }finally{await jobs?.worker.stop();if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-website-freshness-'));await rm(directory,{recursive:true,force:true});}
});


test('direct publishing reuses a named website edition after another website changes and rejects changed inputs before provider writes',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-publisher-'));let fixture;
 try{
  const book=createNotebook('Publishing workspace');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Field journal','Course website'])ids.push((await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  const first=await sites.read(ids[0]),command=edit(first);command.metadata.website={...first.book.website,home:{...first.book.website.home,enabled:true,introduction:'Reviewed journal content'}};await sites.save(ids[0],command);
  const workspace=websiteWorkspace(fixture.workspace,ids[0]),remote=githubFixture(),publisher=new Publisher(workspace.root,{workspace,request:remote.request},workspace.vault),config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:'observanda-site',pages:true});
  const destination=await publisher.save(config,'new');await publisher.connect('synthetic_github_token_1234567890');const candidate=await new PublicationJobs(workspace).inline({etag:(await workspace.outline()).etag});
  const other=await sites.read(ids[1]),otherChange=edit(other);otherChange.metadata.website={...other.book.website,footer:'Unrelated course footer'};await sites.save(ids[1],otherChange);
  const receipt=await publisher.deploy(candidate,destination.etag,book.id);assert.equal(receipt.status,'uploaded-awaiting-pages');assert.equal(receipt.commit,remote.head);
  for(const bytes of remote.blobs.values())assert.equal(bytes.includes(Buffer.from('Unrelated course footer')),false);
  const writes=()=>remote.calls.filter(call=>call.method!=='GET').length,before=writes(),own=await sites.read(ids[0]),ownChange=edit(own);ownChange.metadata.website={...own.book.website,footer:'Changed journal footer'};await sites.save(ids[0],ownChange);
  await assert.rejects(publisher.deploy(candidate,destination.etag,book.id),{code:'STALE'});assert.equal(writes(),before);
  await publisher.save({...config,github:{...config.github,repository:'changed-destination'}},destination.etag);await assert.rejects(publisher.deploy(candidate,destination.etag,book.id),{code:'PUBLISH_STALE'});assert.equal(writes(),before);
 }finally{if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-website-publisher-'));await rm(directory,{recursive:true,force:true});}
});
