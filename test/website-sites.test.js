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
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
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

test('independent websites isolate selections and review IDs and deploy to pinned repositories after restart',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-sites-')),book=upgradeNotebook(sampleNotebook());
 const project={...structuredClone(book.projects[0]),id:randomUUID(),title:'Other project',parentId:null},notebook={...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:project.id};
 const other={...structuredClone(book.entries[0]),id:randomUUID(),notebookId:notebook.id,title:'Other project secret',body:'OTHER_PROJECT_PRIVATE',share:true,sections:[],attachments:[],figures:[],relations:[]};
 book.projects.push(project);book.notebooks.push(notebook);book.entries.push(other);
 const f=await encryptedFixture(directory,book),sites=new WebsiteSites(f.workspace),remotes=[githubFixture({branch:'main',repository:'site-a',initialFiles:{'README.md':'First site'}}),githubFixture({branch:'main',repository:'site-b',initialFiles:{'README.md':'Second site'}})];
 const publisher=new Publisher(f.workspace.root,{request:(url,options)=>remotes[url.includes('/site-b')?1:0].request(url,options)},f.vault);publisher.token='synthetic_github_token_1234567890';
 let jobs=workspaceJobs(f.workspace,publisher),app=null;
 t.after(async()=>{if(app)await app.close();await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const ids=[];for(const [i,p] of [book.projects[0],project].entries()){
  const created=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Site '+i});ids.push(created.id);
  const current=await sites.read(created.id),command={workspaceId:book.id,baseEtag:current.etag,websitePin:current.websitePin,metadata:{},projects:[{id:p.id,share:true,logoId:null}],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[p.id],records:[]}};
  await sites.save(created.id,command);
  if(i===0){const etag=(await f.workspace.outline()).etag;await assert.rejects(sites.save(created.id,{...command,baseEtag:etag,websitePin:(await sites.read(created.id)).websitePin,selection:{defaultShare:false,includeProjects:[],records:[{id:randomUUID(),share:true,attachments:[]}]}}),{code:'INVALID'});assert.equal((await f.workspace.outline()).etag,etag);}
 }
 const scoped=ids.map(id=>websiteWorkspace(f.workspace,id)),publishers=scoped.map(w=>websitePublisher(publisher,w));
 const etag=(await f.workspace.outline()).etag;
 for(let i=0;i<2;i++){const current=await publishers[i].read();await publishers[i].save({...current.config,github:{...current.config.github,owner:'example',repository:i?'site-b':'site-a',branch:'main'}},current.etag);await new PublicationJobs(scoped[i]).start(await source(scoped[i]),websiteJobQueue(jobs.queue,ids[i]));}
 // A fresh worker dispatches each immutable job through its own website.
 jobs=workspaceJobs(f.workspace,publisher);const prepared=[await run(jobs.queue),await run(jobs.queue)];
 for(let i=0;i<2;i++){const candidate=await new PublicationJobs(scoped[i]).read(prepared[i].result.id),text=await publicationText(candidate);assert.equal(text.includes('OTHER_PROJECT_PRIVATE'),i===1);const configEtag=(await publishers[i].read()).etag,plan=await publishers[i].reviewDestination(candidate,configEtag);await new DeploymentJobs(scoped[i],publishers[i],websiteJobQueue(jobs.queue,ids[i])).start({id:candidate.reviewId,configEtag,reviewed:true,destinationReview:plan.id,destinationReviewed:true});}
 await run(jobs.queue);await run(jobs.queue);
 for(let i=0;i<2;i++){assert.ok(remotes[i].head);assert.equal((await publishers[i].read()).receipt.commit,remotes[i].head);assert.equal((await new DeploymentJobs(scoped[i],publishers[i],websiteJobQueue(jobs.queue,ids[i])).page()).items.length,1);}
 assert.equal((await publisher.read()).configured,false);
 app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'prefs.json')});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];
 const request=(route,data,id)=>fetch(app.origin+route,{headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json',...(id?{'X-Observanda-Website':id}:{})},...(data?{method:'POST',body:JSON.stringify(data)}:{})});
 const review=prepared[0].result.id;
 assert.equal((await request('/api/publication-jobs/open',{id:review},ids[1])).status,404);
 assert.equal((await request('/api/publication-jobs/open',{id:review})).status,404);
 const own=await request('/api/publication-jobs/open',{id:review},ids[0]);assert.equal(own.status,200);const summary=await own.json();
 const preview=await request(summary.url);assert.equal(preview.status,200);assert.ok(!(await preview.text()).includes('OTHER_PROJECT_PRIVATE'));
 // Opening a cached edition never grants another site's publishing routes access.
 assert.equal((await request('/api/publication-jobs/open',{id:review},ids[1])).status,404);
 assert.equal((await request('/api/deployment-jobs/status',{id:(await new DeploymentJobs(scoped[0],publishers[0],websiteJobQueue(jobs.queue,ids[0])).page()).items[0].id},ids[1])).status,404);
 await app.close();app=null;
 // Moving research between projects cannot make it public through a site's
 // earlier "include all" choice. Removal prunes only current selections.
 const records=new ResearchRecords(f.workspace,{}),moved={...other,notebookId:book.notebooks[0].id};
 await records.save({workspaceId:book.id,changes:[{id:other.id,expectedRevision:recordRevision(other),record:moved}]});
 let current=await f.workspace.read(),now=current.book.entries.find(r=>r.id===other.id);
 assert.equal((await publicationSource(scoped[0],await source(scoped[0]))).entries.some(r=>r.id===other.id),false);
 assert.equal((await publicationSource(scoped[1],await source(scoped[1]))).entries.some(r=>r.id===other.id),false);
 await records.remove({workspaceId:book.id,recordId:other.id,expectedRevision:recordRevision(now)});
 assert.ok((await sites.read(ids[0])).site.selection.records.every(r=>r.id!==other.id));
 assert.ok(await new PublicationJobs(scoped[1]).read(prepared[1].result.id));
});


test('websites can be created before research projects exist and have no fixed count ceiling',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-independent-sites-')),book=createNotebook('Empty workspace',''),f=await encryptedFixture(directory,book),sites=new WebsiteSites(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
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
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const before=await f.workspace.read(),ids=[];
 for(const name of ['Combined website','Different website'])ids.push((await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name})).id);
 const original=book.entries[0],read=await sites.read(ids[0]);
 await sites.save(ids[0],{workspaceId:book.id,baseEtag:read.etag,websitePin:read.websitePin,metadata:{},projects:book.projects.map(({id})=>({id,share:true,logoId:null})),changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[original,record].map(({id})=>({id,share:true,attachments:[]}))}});
 const etag=(await f.workspace.outline()).etag,selected=await publicationSource(websiteWorkspace(f.workspace,ids[0]),await source(websiteWorkspace(f.workspace,ids[0])));
 assert.deepEqual(new Set(selected.entries.map(r=>r.id)),new Set([original.id,record.id]));
 assert.equal((await publicationSource(websiteWorkspace(f.workspace,ids[1]),await source(websiteWorkspace(f.workspace,ids[1])))).entries.length,0);
 assert.deepEqual((await f.workspace.read()).book.entries,before.book.entries);
});
