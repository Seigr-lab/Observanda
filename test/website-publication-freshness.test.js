import {githubFixture} from './github-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNotebook,upgradeNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {publicationSource} from '../src/publication-source.js';
import {publicationSelection} from '../src/publication-selection.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {PublicationRollback} from '../src/publication-rollback.js';
import {LocalExport} from '../src/local-export.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {publicationRevisionCurrent} from '../src/publication-freshness.js';
import {AppearancePreviewSessions} from '../src/appearance-preview-sessions.js';
import {appearancePreviewSource} from '../src/appearance-preview.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {MediaStore} from '../src/media.js';
import {contentBuffer} from '../src/file-content.js';

const publicationPageText=async(candidate,file=candidate.defaultPage)=>(await contentBuffer(await candidate.files.get(file))).toString('utf8');
const edit=site=>({workspaceId:site.book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{},projects:[],changes:[],removed:[],selection:site.site.selection});

test('another website edit preserves preparation, export, deployment admission and rollback review without admitting changed publication inputs',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-freshness-'));let fixture,jobs;
 try{
  const book=createNotebook('Publishing workspace');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Field journal','Course website'])ids.push((await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  const initial=await sites.read(ids[0]),intro=edit(initial);intro.metadata.website={...initial.book.website,home:{...initial.book.website.home,enabled:true,introduction:'Synthetic publication introduction'}};await sites.save(ids[0],intro);
  const workspace=websiteWorkspace(fixture.workspace,ids[0]),publisher=new Publisher(workspace.root,{workspace,request:()=>{throw Error('Unexpected provider call');}},workspace.vault),config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'field-journal'});
  const destination=await publisher.save(config,'new');jobs=workspaceJobs(fixture.workspace,publisher);const queue=websiteJobQueue(jobs.queue,ids[0]),releases=new PublicationJobs(workspace),{etag,websitePin}=await workspace.outline(),candidate=await releases.inline({etag,websitePin});
  const rollback=new PublicationRollback(workspace,publisher),approval=await rollback.review({id:candidate.reviewId});
  async function change(id,footer){const site=await sites.read(id),command=edit(site);command.metadata.website={...site.book.website,footer};await sites.save(id,command);}
  await change(ids[1],'Unrelated course footer');
  assert.equal((await fixture.workspace.outline()).etag,etag);assert.deepEqual((await sites.version(ids[0])).websitePin,websitePin);
  assert.equal((await publicationSource(workspace,{etag,websitePin})).website.title,'Field journal');
  const rename=await sites.read(ids[0]);await sites.change({workspaceId:book.id,etag:rename.etag,websitePin:rename.websitePin,operation:'rename',id:ids[0],name:'Renamed editor label'});
  assert.notEqual((await sites.version(ids[0])).websitePin.websiteRevision,websitePin.websiteRevision);assert.equal(await publicationRevisionCurrent(workspace,candidate),true);
  const another=await releases.inline({etag,websitePin});assert.equal(another.websiteId,ids[0]);assert.equal((await rollback.authorize(candidate,approval.review.id)).id,approval.review.id);
  const output=path.join(directory,'published');await mkdir(output);const exporter=new LocalExport(workspace),plan=await exporter.plan({reviewId:candidate.reviewId,directory:output});await exporter.apply({id:plan.id,reviewed:true});
  assert.match(await readFile(path.join(output,candidate.defaultPage),'utf8'),/Field journal/);
  const deployments=new DeploymentJobs(workspace,publisher,queue),intent={id:candidate.reviewId,configEtag:destination.etag,reviewed:true};
  const changed=await publisher.save({...config,github:{...config.github,repository:'changed-destination'}},destination.etag);
  await assert.rejects(deployments.start(intent),{code:'PUBLISH_STALE'});await assert.rejects(deployments.start({...intent,configEtag:changed.etag}),{code:'PUBLISH_STALE'});
  await assert.rejects(publisher.deploy(candidate,destination.etag,book.id),{code:'PUBLISH_STALE'});await assert.rejects(rollback.authorize(candidate,approval.review.id),{code:'PUBLISH_STALE'});
  assert.equal((await publisher.save(config,changed.etag)).etag,destination.etag);
  const job=await deployments.start(intent);assert.equal(job.state,'queued');
  await change(ids[0],'Changed journal footer');
  assert.equal((await fixture.workspace.outline()).etag,etag);assert.notEqual((await sites.version(ids[0])).websitePin.websiteRevision,websitePin.websiteRevision);
  const retained=await releases.read(candidate.reviewId);assert.deepEqual(retained.websitePin,websitePin);assert.deepEqual((await releases.source(candidate.jobId)).websitePin,websitePin);assert.equal(await publicationPageText(retained),await publicationPageText(candidate));
  await assert.rejects(publicationSource(workspace,{etag,websitePin}),{code:'CONFLICT'});await assert.rejects(releases.inline({etag,websitePin}),{code:'CONFLICT'});
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
  const destination=await publisher.save(config,'new');await publisher.connect('synthetic_github_token_1234567890');const candidate=await new PublicationJobs(workspace).inline(await workspace.outline());
  const other=await sites.read(ids[1]),otherChange=edit(other);otherChange.metadata.website={...other.book.website,footer:'Unrelated course footer'};await sites.save(ids[1],otherChange);
  const receipt=await publisher.deploy(candidate,destination.etag,book.id);assert.equal(receipt.status,'uploaded-awaiting-pages');assert.equal(receipt.commit,remote.head);
  for(const bytes of remote.blobs.values())assert.equal(bytes.includes(Buffer.from('Unrelated course footer')),false);
  const writes=()=>remote.calls.filter(call=>call.method!=='GET').length,before=writes(),own=await sites.read(ids[0]),ownChange=edit(own);ownChange.metadata.website={...own.book.website,footer:'Changed journal footer'};await sites.save(ids[0],ownChange);
  await assert.rejects(publisher.deploy(candidate,destination.etag,book.id),{code:'STALE'});assert.equal(writes(),before);
  await publisher.save({...config,github:{...config.github,repository:'changed-destination'}},destination.etag);await assert.rejects(publisher.deploy(candidate,destination.etag,book.id),{code:'PUBLISH_STALE'});assert.equal(writes(),before);
 }finally{if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-website-publisher-'));await rm(directory,{recursive:true,force:true});}
});


test('default website retains exact appearance and edition pins after a same-head edit and keeps root publishing paths',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-default-website-pin-'));let fixture,previews;
 try{
  const book=upgradeNotebook(sampleNotebook());book.title='Default publishing workspace';book.entries=[book.entries[1]];book.entries[0].body='Retained default research original';fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace);
  const media=new MediaStore(fixture.workspace),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>'),'image'),records=new ResearchRecords(fixture.workspace,media);
  const withAttachment={...book.entries[0],attachments:[{...asset,caption:'Retained observation image',alt:'Observation circle',transcript:'',share:true}]};
  book.entries[0]=(await records.save({workspaceId:book.id,changes:[{id:withAttachment.id,expectedRevision:recordRevision(book.entries[0]),record:withAttachment}]},{recordIds:[withAttachment.id]})).book.entries[0];
  const initial=await sites.read(null),command=edit(initial);command.metadata.website={...initial.book.website,home:{...initial.book.website.home,enabled:true,introduction:'Retained default introduction'},footer:'Retained default footer'};
  command.selection=structuredClone(command.selection);command.selection.records.find(value=>value.id===withAttachment.id).attachments=[{id:asset.id,share:true}];
  const saved=await sites.save(null,command),otherId=(await sites.change({workspaceId:book.id,etag:saved.etag,operation:'create',name:'Independent website'})).id;
  const workspace=websiteWorkspace(fixture.workspace,null),other=websiteWorkspace(fixture.workspace,otherId),publisher=new Publisher(workspace.root,{workspace,request:()=>{throw Error('Unexpected provider call');}},workspace.vault),config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'default-website'});
  const destination=await publisher.save(config,'new'),releases=new PublicationJobs(workspace),source={etag:saved.etag,websitePin:saved.websitePin},candidate=await releases.inline(source);
  assert.equal(candidate.files.output.count('entries'),1);assert.equal(candidate.websiteId,null);assert.equal(candidate.version,3);assert.deepEqual(candidate.websitePin,saved.websitePin);assert.equal((await releases.source(candidate.jobId)).version,6);
  assert.equal(workspace.metadataPath('.observanda/publishing.json'),fixture.workspace.metadataPath('.observanda/publishing.json'));
  assert.deepEqual(JSON.parse(await fixture.workspace.readMetadata('.observanda/publishing.json',16384)),config);assert.equal(await other.readMetadata('.observanda/publishing.json',16384),null);
  const stored=JSON.parse(await fixture.workspace.readMetadata('.observanda/release-candidates/'+candidate.reviewId+'.json',1024*1024));assert.deepEqual(stored.websitePin,saved.websitePin);assert.equal(await other.readMetadata('.observanda/release-candidates/'+candidate.reviewId+'.json',1024*1024),null);
  const appearance={workspaceId:book.id,...source,appearance:saved.book.appearance,mode:'website'};previews=new AppearancePreviewSessions();
  const preview=await previews.create(workspace,appearance,{media:new MediaStore(workspace),fonts:new WorkspaceFonts(workspace)}),sessionId=preview.baseUrl.split('/').filter(Boolean).at(-1);
  assert.deepEqual(preview.websitePin,saved.websitePin);const before=await previews.page(sessionId,preview.defaultPage),beforeHtml=await publicationPageText(before,preview.defaultPage);assert.match(beforeHtml,/Retained default footer/);
  const current=await sites.read(null),change=edit(current);change.metadata.website={...current.book.website,footer:'New default footer'};const next=await sites.save(null,change);
  assert.equal(next.etag,saved.etag);assert.notEqual(next.websitePin.websiteRevision,saved.websitePin.websiteRevision);assert.equal(next.websitePin.websiteId,null);
  assert.equal(await publicationRevisionCurrent(workspace,candidate),false);assert.equal((await publisher.read()).etag,destination.etag);
  previews.cache.clear();const retained=await previews.page(sessionId,preview.defaultPage);assert.equal(await publicationPageText(retained,preview.defaultPage),beforeHtml);
  assert.deepEqual((await previews.choices(sessionId)).websitePin,saved.websitePin);assert.equal((await appearancePreviewSource(workspace,{...appearance,websitePin:next.websitePin})).book.website.footer,'New default footer');
  await assert.rejects(appearancePreviewSource(workspace,{...appearance,websitePin:undefined}),{code:'INVALID'});
  await assert.rejects(appearancePreviewSource(workspace,{...appearance,websitePin:{...saved.websitePin,websiteId:otherId}}),{code:'INVALID'});
  const retainedEdition=await releases.read(candidate.reviewId);assert.equal(await publicationPageText(retainedEdition),await publicationPageText(candidate));assert.match(await publicationPageText(retainedEdition,'entries/'+book.entries[0].id+'.html'),/Retained default research original/);
  // Ordinary research edits change the original membership, not saved website
  // consent. Removed attachments disappear from current projections while the
  // exact earlier edition and appearance session retain their original image.
  const original=book.entries[0],entryPage='entries/'+original.id+'.html',mediaPath='media/'+asset.id+'.png';assert.ok(await candidate.files.has(mediaPath));
  await records.save({workspaceId:book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,attachments:[]}}]},{receipt:true});
  const afterRemoval=await sites.read(null),currentSource={etag:afterRemoval.etag,websitePin:afterRemoval.websitePin};
  assert.notEqual(afterRemoval.etag,next.etag);assert.equal(afterRemoval.websitePin.websiteRevision,next.websitePin.websiteRevision);
  assert.deepEqual(afterRemoval.site.selection.records.find(value=>value.id===original.id).attachments,[{id:asset.id,share:true}]);
  const currentBook=await publicationSource(workspace,currentSource);assert.deepEqual(currentBook.entries[0].attachments,[]);
  const inventory=await publicationSelection(workspace,{source:currentSource});assert.deepEqual(inventory.items[0].attachments,[]);assert.deepEqual(inventory.items[0].choice.attachments,[]);
  const {websitePin:inheritedPin,...inheritedDraft}=edit(afterRemoval);void inheritedPin;
  assert.deepEqual((await publicationSource(workspace,{...currentSource,draft:inheritedDraft})).entries[0].attachments,[]);
  const currentCandidate=await releases.inline({...currentSource,draft:inheritedDraft});assert.equal(await currentCandidate.files.has(mediaPath),false);assert.ok(!(await publicationPageText(currentCandidate,entryPage)).includes(asset.id));
  const currentPreview=await previews.create(workspace,{...appearance,...currentSource},{media,fonts:new WorkspaceFonts(workspace)}),currentSession=currentPreview.baseUrl.split('/').filter(Boolean).at(-1),currentPage=await previews.page(currentSession,entryPage);
  assert.equal(currentPage.files.has(mediaPath),false);assert.ok(!(await publicationPageText(currentPage,entryPage)).includes(asset.id));
  const inherited=await sites.save(null,edit(afterRemoval));assert.deepEqual(inherited.websitePin,afterRemoval.websitePin);
  for(const choice of [{id:randomUUID(),share:true},{id:asset.id,share:false}]){
   const forged=edit(inherited);forged.selection=structuredClone(forged.selection);forged.selection.records.find(value=>value.id===original.id).attachments=[choice];
   await assert.rejects(sites.save(null,forged),{code:'INVALID'});
   const {websitePin,...draft}=forged;void websitePin;await assert.rejects(publicationSource(workspace,{...currentSource,draft}),{code:'INVALID'});
  }
  const cleared=edit(inherited);cleared.selection=structuredClone(cleared.selection);cleared.selection.records.find(value=>value.id===original.id).attachments=[];
  const recovered=await sites.save(null,cleared);assert.deepEqual(recovered.site.selection.records.find(value=>value.id===original.id).attachments,[]);
  previews.cache.clear();const oldPage=await previews.page(sessionId,entryPage);assert.ok(oldPage.files.has(mediaPath));assert.ok((await publicationPageText(oldPage,entryPage)).includes(asset.id));
  assert.deepEqual(await contentBuffer(await (await releases.read(candidate.reviewId)).files.get(mediaPath)),await contentBuffer(await candidate.files.get(mediaPath)));
  assert.deepEqual((await sites.read(null,{websitePin:saved.websitePin})).site.selection.records.find(value=>value.id===original.id).attachments,[{id:asset.id,share:true}]);
 }finally{previews?.clear();if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-default-website-pin-'));await rm(directory,{recursive:true,force:true});}
});
