import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,createNotebook} from '../src/model.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {publicationSource} from '../src/publication-source.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {Publisher} from '../src/publishing.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {publicationText} from './publication-fixture.js';
import {clearVault} from '../src/encryption.js';
import {randomUUID} from 'node:crypto';
import {startServer} from '../src/server.js';
import {githubFixture} from './github-fixture.js';
import {websitePublisher} from '../src/workspace-jobs.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {websiteSelectionDraft} from '../src/web/website-selection.js';

const source=async workspace=>{const value=await workspace.currentOutline();return {etag:value.etag,websitePin:value.websitePin};};
async function run(queue){const job=await queue.claim();const output=await queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:async()=>{}});return queue.complete(job.id,job.lease.token,output);}

test('independent websites persist separate designs, selections, destinations and retained editions',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sites-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book),sites=new WebsiteSites(f.workspace),jobs=workspaceJobs(f.workspace);
 t.after(async()=>{await jobs.worker.stop();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const original=await f.workspace.read(),projectId=book.notebooks.find(n=>n.id===book.entries[0].notebookId).projectId;
 const create=async name=>sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name});
 const a=(await create('Project journal')).id,b=(await create('Help website')).id;
 const read=await sites.read(a);assert.equal(read.book.projects[0].id,projectId);assert.ok(read.outline);
 const selected=book.entries.find(r=>read.book.notebooks.some(n=>n.id===r.notebookId));
 const edit={workspaceId:book.id,baseEtag:read.etag,websitePin:read.websitePin,metadata:{website:{...read.book.website,footer:'Journal footer'}},projects:[{id:projectId,share:true,logoId:null}],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:selected.id,share:true,attachments:[]}]}};
 await sites.save(a,edit);
 const reopened=await sites.read(a),draft=websiteSelectionDraft();draft.load(reopened.site.selection,reopened.selectionProjects);assert.equal(draft.isDirty(),false);draft.includeProject(projectId);assert.deepEqual(draft.snapshot(),{defaultShare:false,includeProjects:[projectId],records:[]});
 await assert.rejects(sites.save(a,edit),{code:'CONFLICT'});
 const wa=websiteWorkspace(f.workspace,a),wb=websiteWorkspace(f.workspace,b),etag=(await f.workspace.outline()).etag;
 assert.deepEqual((await publicationSource(wa,await source(wa))).entries.map(r=>r.id),[selected.id]);
 assert.equal((await publicationSource(wb,await source(wb))).entries.length,0);
 await assert.rejects(publicationSource(wa,{...await source(wa),book}),{code:'INVALID'});
 const pa=new Publisher(f.workspace.root,{workspace:wa},f.vault),pb=new Publisher(f.workspace.root,{workspace:wb},f.vault),config=await pa.read();
 await pa.save({...config.config,github:{...config.config.github,owner:'Example',repository:'journal'}},config.etag);
 assert.equal((await pb.read()).configured,false);assert.equal((await pa.read()).config.github.repository,'journal');
 const queue=websiteJobQueue(jobs.queue,a),release=new PublicationJobs(wa),job=await release.start(await source(wa),queue);
 assert.equal(job.input.websiteId,a);assert.equal(await websiteJobQueue(jobs.queue,b).read(job.id),null);
 const leased=await jobs.queue.claim(),output=await jobs.queue.definitions[leased.type].prepare(leased,{signal:new AbortController().signal,progress:async()=>{}});
 await jobs.queue.complete(leased.id,leased.lease.token,output);
 const candidate=await release.read(output.reviewId);assert.equal(candidate.websiteId,a);assert.ok((await publicationText(candidate)).includes('Journal footer'));
 assert.equal(await new PublicationJobs(wb).read(output.reviewId),null);
 assert.equal(JSON.parse(await f.workspace.readMetadata('.observanda/website-editions/'+output.reviewId+'.json')).websiteId,a);
 const saved=await f.workspace.read();assert.deepEqual(saved.book.entries,original.book.entries);assert.deepEqual(saved.book.website,original.book.website);
 assert.equal((await new WebsiteSites(f.workspace).read(a)).book.website.footer,'Journal footer');assert.equal((await sites.read(b)).book.website.footer,'');
});

test('websites can be created before research projects exist and have no fixed count ceiling',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-independent-sites-')),book=createNotebook('Empty workspace',''),f=await encryptedFixture(directory,book),sites=new WebsiteSites(f.workspace);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const head=await f.workspace.outline();assert.deepEqual(head.metadata.projects,[]);
 const created=await sites.change({workspaceId:book.id,etag:head.etag,operation:'create',name:'Public journal'}),first=await sites.read(created.id);
 assert.equal(first.site.projectId,null);assert.deepEqual(first.book.notebooks,[]);assert.equal(first.total,0);
 for(let i=1;i<100;i++)await sites.change({workspaceId:book.id,etag:head.etag,operation:'create',name:'Website '+i});
 const last=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Website 101'});
 assert.equal(last.sites.length,20);let after=null;const ids=new Set();do{const page=await sites.list({after,limit:20});for(const site of page.sites){assert.equal(ids.has(site.id),false);ids.add(site.id);}after=page.next;}while(after);assert.equal(ids.size,101);assert.equal((await sites.read(last.id)).site.name,'Website 101');
 await assert.rejects(sites.change({workspaceId:book.id,etag:last.etag,operation:'create',name:'Wrong owner',projectId:randomUUID()}),{code:'INVALID'});
 assert.equal((await f.workspace.outline()).etag,last.etag);
});

test('one independent website combines lab books from different projects without changing another website',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-mixed-sites-')),book=sampleNotebook(),project={...structuredClone(book.projects[0]),id:randomUUID(),title:'Second research project'},notebook={...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:project.id,title:'Second lab book'},record={...structuredClone(book.entries[0]),id:randomUUID(),notebookId:notebook.id,title:'Selected from a second book'};
 book.projects.push(project);book.notebooks.push(notebook);book.entries.push(record);
 const f=await encryptedFixture(directory,book),sites=new WebsiteSites(f.workspace);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const before=await f.workspace.read(),ids=[];
 for(const name of ['Combined website','Different website'])ids.push((await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name})).id);
 const original=book.entries[0],read=await sites.read(ids[0]);
 await sites.save(ids[0],{workspaceId:book.id,baseEtag:read.etag,websitePin:read.websitePin,metadata:{},projects:book.projects.map(({id})=>({id,share:true,logoId:null})),changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[original,record].map(({id})=>({id,share:true,attachments:[]}))}});
 const etag=(await f.workspace.outline()).etag,selected=await publicationSource(websiteWorkspace(f.workspace,ids[0]),await source(websiteWorkspace(f.workspace,ids[0])));
 assert.deepEqual(new Set(selected.entries.map(r=>r.id)),new Set([original.id,record.id]));
 assert.equal((await publicationSource(websiteWorkspace(f.workspace,ids[1]),await source(websiteWorkspace(f.workspace,ids[1])))).entries.length,0);
 assert.deepEqual((await f.workspace.read()).book.entries,before.book.entries);
});
