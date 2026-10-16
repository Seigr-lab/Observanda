import {ReviewIdentity,reviewHash} from '../src/security/review-exchange.js';
import {TestDeviceStore} from './device-fixture.js';
import {retainedDraft} from './fixtures/record-draft-review.js';
import {RECORD_DRAFT_CHUNK_BYTES} from '../src/web/record-draft-protocol.js';
import {createHash} from 'node:crypto';
import {viewQuery} from '../src/web/record-view-model.js';
import {githubFixture} from './github-fixture.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {projectMaterialReferenceRequest,addressedMaterialReference} from '../src/project-material-reference.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ProjectDeletions} from '../src/project-deletion.js';
import {databaseCapacity} from '../src/postgres.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectMoves} from '../src/project-move.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {RecordWriting} from '../src/record-writing.js';
import {recordBrowse} from '../src/web/record-query.js';
import {recordRevision} from '../src/research.js';
import {seedModuleCurrent} from './module-current-fixture.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {WorkspaceCopyRecovery} from '../src/workspace-copy-recovery.js';

async function fixture(t,{publishingOptions,nested=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-http-')),vaults=[],owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);let app;
 t.after(async()=>{await app?.close();await owner.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-http-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook(),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id);
 const create=async(name,password='')=>{const book=sampleNotebook(),id=book.projects[0].id,access=await createWorkspaceAccess('',password,f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);book.title=book.projects[0].title=name;const storage=await initializeProjectLocation(path.join(nested?f.workspace.root:directory,name),id,book,access,vault);await registry.attach(storage,{expected:(await registry.read()).revision});return {id,book,storage,vault};};
 const a=await create('a'),b=await create('b'),locked=await create('locked','A separate project password');app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,publishingOptions});
 const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=response.headers.get('set-cookie').split(';')[0];
 const context=(await(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}})).json()).contextId;
 const call=(route,data={},headers={},options={})=>fetch(app.origin+route,{signal:options.signal??AbortSignal.timeout(30000),method:'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1',...headers},body:JSON.stringify(data)});
 const project=(p,route,data,headers,options)=>call('/api/projects/'+p.id+'/'+route,data,headers,options);
 const activity=async()=>result(await fetch(app.origin+'/api/activity',{headers:{Cookie:cookie}}));
 const raw=(route,{method='GET',bytes,headers={}}={})=>fetch(app.origin+route,{method,headers:{Origin:app.origin,Cookie:cookie,'X-Observanda-Workspace':context,...headers},...(bytes?{body:bytes}:{})});
 return {...f,book,directory,owner,registry,a,b,locked,app,call,project,activity,raw,context};
}
const target=p=>({workspaceId:p.book.id,recordId:p.book.entries[0].id,sectionId:null});
async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}

test('HTTP project authoring, search and history stay independent during a workspace copy',async t=>{
 const f=await fixture(t),beforeB=await f.b.storage.outline(),checkpoint=WorkspaceCopyRecovery.prototype.database;let release,entered;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 WorkspaceCopyRecovery.prototype.database=async function(...args){await checkpoint.apply(this,args);entered();await gate;};
 const rootDraft=await retainedDraft(f.workspace,f.book.id,f.book.entries[0],{...f.book.entries[0],title:'Workspace retained checkpoint'});
 let copying;
 try{
  await result(await f.project(f.locked,'access/unlock',{password:'A separate project password'}));
  copying=f.call('/api/storage/copy',{path:path.join(f.directory,'workspace-copy'),confirmed:true},{},{signal:AbortSignal.timeout(120000)});
  await Promise.race([ready,copying.then(async response=>{throw Error('Copy ended before its database checkpoint: '+response.status+' '+await response.clone().text());})]);
  assert.deepEqual((await result(await f.call('/api/research/starters/list',{workspaceId:f.book.id,cursor:null}))).items,[]);
  assert.deepEqual((await result(await f.call('/api/research/views/list',{workspaceId:f.book.id}))).views,[]);
  assert.equal((await result(await f.call('/api/research/drafts/read',{id:rootDraft.draft.id,summary:true}))).revision,rootDraft.revision);
  assert.equal((await result(await f.call('/api/research/drafts/content',{id:rootDraft.draft.id,workspaceId:f.book.id,expectedRevision:rootDraft.revision,offset:0}))).title,'Workspace retained checkpoint');
  const a=await result(await f.project(f.a,'research/records/writing/read',target(f.a)));
  await result(await f.project(f.a,'research/records/writing/save',{...target(f.a),expectedRevision:a.revision,value:{body:'Independent projected observation'}}));
  const current=await result(await f.project(f.a,'research/records/writing/read',target(f.a)));assert.equal(current.value.body,'Independent projected observation');
  const query=await result(await f.project(f.a,'research/records/query',{workspaceId:f.a.book.id,query:{projectId:null,notebookId:null,filter:'all',search:'projected observation',browse:recordBrowse()},limit:10}));assert.deepEqual(query.records.map(record=>record.id),[f.a.book.entries[0].id]);
  const history=await result(await f.project(f.a,'research/records/history/list',{workspaceId:f.a.book.id,recordId:f.a.book.entries[0].id}));assert.ok(history);
  assert.equal((await result(await f.project(f.b,'research/records/writing/read',target(f.b)))).value.body,f.b.book.entries[0].body);assert.equal((await f.b.storage.outline()).etag,beforeB.etag);
  await result(await f.project(f.b,'research/records/writing/read',target(f.a)),409);
  await result(await f.project(f.a,'research/records/writing/read',target(f.a),{'X-Observanda-Workspace':randomUUID()}),409);
  release();await result(await copying);
 }finally{release();WorkspaceCopyRecovery.prototype.database=checkpoint;if(copying)await copying.catch(()=>{});}
});

test('a busy project does not queue its siblings and project credentials stay scoped',async t=>{
 const f=await fixture(t),view=await result(await f.project(f.a,'research/records/writing/read',target(f.a))),db=await f.a.storage.openCatalogue();await db.run('BEGIN');await db.lock();let pending;
 try{
  pending=f.project(f.a,'research/records/writing/save',{...target(f.a),expectedRevision:view.revision,value:{body:'A queued edit'}});
  const b=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));await result(await f.project(f.b,'research/records/writing/save',{...target(f.b),expectedRevision:b.revision,value:{body:'B saved independently'}}));
  const denied=await f.project(f.locked,'research/records/writing/read',target(f.locked));assert.notEqual(denied.status,200);assert.equal((await denied.json()).projectId,f.locked.id);
  await result(await f.project(f.locked,'access/unlock',{password:'A separate project password'}));await result(await f.project(f.locked,'research/records/writing/read',target(f.locked)));
  await result(await f.project(f.locked,'access/lock'));await result(await f.project(f.locked,'research/records/writing/read',target(f.locked)),401);
  await result(await f.project(f.b,'research/records/writing/read',target(f.b)));
  await db.run('ROLLBACK');await result(await pending);
  const source=f.b.book.entries[0];const reference=await result(await f.project(f.b,'reference',{domain:'research',kind:'record',id:source.id}));assert.equal(reference.target.projectId,f.b.id);assert.equal(reference.value.body,'B saved independently');
  await result(await f.project(f.b,'reference',{projectId:f.a.id,domain:'research',kind:'record',id:source.id}),422);
 }finally{await db.close();if(pending)await pending.catch(()=>{});}
});

test('locking a project cancels its queued save without locking other owners or retaining activity',async t=>{
 const f=await fixture(t),view=await result(await f.project(f.a,'research/records/writing/read',target(f.a))),db=await f.a.storage.openCatalogue();await db.run('BEGIN');await db.lock();let pending;
 try{
  pending=f.project(f.a,'research/records/writing/save',{...target(f.a),expectedRevision:view.revision,value:{body:'Cancelled by project lock'}});
  const deadline=Date.now()+10000;
  while(!(await f.activity()).operations.some(item=>item.kind.includes(f.a.id)&&item.state==='queued')){if(Date.now()>deadline)throw Error('Project write never queued');await delay(25);}
  await result(await f.project(f.a,'access/lock'));await result(await pending,401);
  assert.equal((await new RecordWriting(f.a.storage).read(target(f.a))).value.body,view.value.body);
  await result(await f.project(f.b,'research/records/writing/read',target(f.b)));
  assert.ok(!(await f.activity()).operations.some(item=>['queued','running'].includes(item.state)));
  await db.run('ROLLBACK');await result(await f.project(f.a,'access/unlock'));await result(await f.project(f.a,'research/records/writing/read',target(f.a)));
 }finally{await db.close();if(pending)await pending.catch(()=>{});}
});

test('HTTP creation uses a durable project identity and opens it through the same authoring route',async t=>{
 const f=await fixture(t),project={id:randomUUID(),title:'Created through the application',description:'',parentId:f.a.id,share:false,logoId:null,kind:'Experiment',tools:[]},command={id:randomUUID(),path:path.join(f.directory,'http-created'),project,username:'',password:''};
 const before=await result(await f.call('/api/projects/list',{offset:0,limit:2,revision:null}));assert.equal(before.projects.length,2);assert.equal(before.total,3);
 const attach=ProjectRegistry.prototype.attach;let created,release,entered;const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),busy=f.workspace.withLock(async()=>{entered();await held;});await ready;
 try{
  ProjectRegistry.prototype.attach=async function(storage,options){if(storage.projectId===project.id)throw Error('Interrupted creation');return attach.call(this,storage,options);};
  await result(await f.call('/api/projects/create',command),500);ProjectRegistry.prototype.attach=attach;
  const pending=await result(await f.call('/api/projects/create/pending',{after:null,limit:20}));assert.equal(pending.items.length,1);assert.equal(pending.items[0].id,command.id);assert.equal(pending.items[0].running,false);
  await result(await f.call('/api/projects/create/pending',{after:null,limit:1000}),422);
  await result(await f.call('/api/projects/create/resume',{id:randomUUID(),username:'',password:''}),404);
  await result(await f.call('/api/projects/create/resume',{id:command.id,username:'',password:'',path:command.path}),422);
  created=await result(await f.call('/api/projects/create/resume',{id:command.id,username:'',password:''}));
  assert.deepEqual(await result(await f.call('/api/projects/create/pending',{after:null,limit:20})),{items:[],next:null});
  assert.ok(!(await f.activity()).operations.some(item=>['queued','running'].includes(item.state)));
 }finally{ProjectRegistry.prototype.attach=attach;release();await busy;}
 assert.equal(created.project.projectId,project.id);assert.equal(created.project.parentId,f.a.id);
 assert.deepEqual(await result(await f.call('/api/projects/create',command)),created);
 await result(await f.call('/api/projects/list',{offset:2,limit:2,revision:before.revision}),409);
 const listed=await result(await f.call('/api/projects/list',{offset:0,limit:100,revision:null}));assert.equal(listed.total,4);
 const opened=await result(await f.project({id:project.id},'workspace/read/start',{}));assert.equal(opened.metadata.projects[0].id,project.id);assert.equal(opened.metadata.projects[0].title,project.title);assert.equal(opened.metadata.projects[0].parentId,null);
 const sample=sampleNotebook(),notebook={...sample.notebooks[0],id:randomUUID(),projectId:project.id},createdOwner={id:project.id};
 await result(await f.project(createdOwner,'workspace/structure',{etag:opened.etag,change:{kind:'notebook',value:notebook},response:'outline',commandId:randomUUID()}));
 const record={...sample.entries[0],id:randomUUID(),notebookId:notebook.id,title:'First independently stored record',body:'Original writing',relations:[],figures:[],attachments:[]};
 await result(await f.project(createdOwner,'research/records/save',{workspaceId:opened.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]}));
 const selected={workspaceId:opened.metadata.id,recordId:record.id,sectionId:null},writing=await result(await f.project(createdOwner,'research/records/writing/read',selected));
 const draft={id:randomUUID(),workspaceId:selected.workspaceId,recordId:record.id,expectedRevision:null,writing:{sectionId:null,revision:writing.revision,storageRevision:writing.storageRevision},value:{body:'Retained project draft'}};
 const retained=await result(await f.project(createdOwner,'research/drafts/writing/write',draft));
 await f.owner.closeProject(created.project.root);
 const recovered=await result(await f.project(createdOwner,'research/drafts/writing/read',{id:draft.id,workspaceId:selected.workspaceId,expectedRevision:retained.revision}));assert.equal(recovered.value.body,'Retained project draft');
 assert.equal((await result(await f.project(createdOwner,'research/records/writing/read',selected))).value.body,'Original writing');
 await result(await f.project(createdOwner,'research/records/writing/save',{...selected,expectedRevision:writing.revision,value:recovered.value}));
 assert.equal((await result(await f.project(createdOwner,'research/records/writing/read',selected))).value.body,'Retained project draft');
 assert.ok(!(await f.workspace.outline()).metadata.projects.some(item=>item.id===project.id));
});


test('saved cross-project references resolve by namespace with access control and indexed backlinks',async t=>{
 const f=await fixture(t),source=f.a.book.entries[0],destination=f.b.book.entries[0],reference={workspaceId:f.b.book.id,kind:'record',id:destination.id,revision:recordRevision(destination)};
 const record=(await result(await f.project(f.a,'workspace/read/selection',{workspaceId:f.a.book.id,ids:[source.id]}))).book.entries[0];
 const changed={...record,relations:[{id:randomUUID(),type:'Builds on',target:reference,label:'Independent target'}]};
 await result(await f.project(f.a,'research/records/save',{workspaceId:f.a.book.id,changes:[{id:source.id,expectedRevision:recordRevision(record),record:changed}]}));
 const query={projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()};
 const back=await result(await f.project(f.a,'research/records/query',{workspaceId:f.a.book.id,query,relatedTo:{workspaceId:f.b.book.id,id:destination.id},limit:10}));assert.deepEqual(back.records.map(r=>r.id),[source.id]);
 const reconstruct=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Reference navigation loaded a whole record');};
 try{const location=await result(await f.call('/api/projects/reference-location',reference));assert.equal(location.registered,true);assert.equal(location.projectId,f.b.id);assert.equal(location.value,undefined);
 const page=await result(await f.project(f.b,'research/materials/record',{ref:reference}));assert.equal(page.previous.record.id,destination.id);
 }finally{ResearchCatalogue.prototype.record=reconstruct;}
 assert.deepEqual(await result(await f.call('/api/projects/reference-location',{...reference,workspaceId:randomUUID()})),{registered:false});
 await result(await f.call('/api/projects/reference-location',{...reference,id:randomUUID()}),404);
 const resolved=await result(await f.call('/api/projects/reference',reference));assert.equal(resolved.projectId,f.b.id);assert.equal(resolved.revision,reference.revision);assert.deepEqual(resolved.target,reference);
 const writing=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));
 await result(await f.project(f.b,'research/records/writing/save',{...target(f.b),expectedRevision:writing.revision,value:{body:'The target evolved'}}));
 assert.equal((await result(await f.call('/api/projects/reference',reference))).value.body,destination.body);
 const current={workspaceId:f.b.book.id,kind:'record',id:destination.id};assert.equal((await result(await f.call('/api/projects/reference',current))).value.body,'The target evolved');
 await result(await f.project(f.b,'access/lock'));await result(await f.call('/api/projects/reference',reference),401);assert.equal((await result(await f.call('/api/projects/reference-location',reference),401)).projectId,f.b.id);
 assert.equal((await result(await f.project(f.a,'workspace/read/selection',{workspaceId:f.a.book.id,ids:[source.id]}))).book.entries[0].relations[0].target.workspaceId,f.b.book.id);
 await result(await f.project(f.b,'access/unlock'));await f.owner.closeProject(f.b.storage.root);
 assert.equal((await result(await f.call('/api/projects/reference',reference))).revision,reference.revision);
 await result(await f.call('/api/projects/reference',{...current,workspaceId:randomUUID()}),404);
 await result(await f.call('/api/projects/reference',{...current,workspaceId:f.a.book.id}),404);
 const registry=await f.registry.read(),collision=structuredClone(registry.value);collision.projects[1].namespaceId=collision.projects[0].namespaceId;assert.throws(()=>f.registry.validate(collision),{code:'FORMAT'});
});


test('selected module readers use the project owner while an unrelated project writer is held',async t=>{
 const f=await fixture(t),now=new Date().toISOString(),id=randomUUID(),entity={id,type:'task',revision:1,createdAt:now,updatedAt:now,data:{title:'Only this project task',description:'Private project work',status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]}};
 await seedModuleCurrent(f.a.storage,f.a.book.id,[entity]);
 const db=await f.b.storage.openCatalogue();
 try{
  await db.run('BEGIN');await db.lock();
  const page=await result(await f.project(f.a,'modules/items',{workspaceId:f.a.book.id,type:'task'}));assert.deepEqual(page.items.map(item=>item.id),[id]);
  const selected=await result(await f.project(f.a,'modules/item',{workspaceId:f.a.book.id,id}));assert.equal(selected.entity.data.title,entity.data.title);
  await result(await f.project(f.a,'modules/items',{workspaceId:f.b.book.id,type:'task'}),409);
  assert.equal((await result(await f.project(f.b,'modules/items',{workspaceId:f.b.book.id,type:'task'}))).items.length,0);
 }finally{await db.close();}
});

test('HTTP project move keeps sibling authoring available and follows the adopted owner',async t=>{
 const f=await fixture(t,{nested:true}),before=await result(await f.project(f.a,'research/records/writing/read',target(f.a))),id=randomUUID(),destination=path.join(f.b.storage.root,path.basename(f.a.storage.root)),command={id,parentId:f.b.id,expectedParentId:null};
 const moving=f.project(f.a,'storage/move',command);
 const sibling=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));
 await result(await f.project(f.b,'research/records/writing/save',{...target(f.b),expectedRevision:sibling.revision,value:{body:'Still authoring B during A move'}}));
 assert.equal((await result(await moving)).project.parentId,f.b.id);
 assert.equal((await f.registry.locate(f.a.id)).root,destination);
 assert.equal((await result(await f.project(f.a,'research/records/writing/read',target(f.a)))).value.body,before.value.body);
 assert.equal((await result(await f.project(f.a,'storage/move',command))).project.root,destination);
 assert.equal((await result(await f.project(f.a,'storage/move/resume',{id}))).project.root,destination);assert.equal((await result(await f.project(f.a,'storage/move/status'))).move.phase,'complete');
 assert.equal((await result(await f.project(f.b,'research/records/writing/read',target(f.b)))).value.body,'Still authoring B during A move');
});
test('opening a project recovers interrupted move adoption instead of stranding a frozen source',async t=>{
 const f=await fixture(t),id=randomUUID(),destination=path.join(f.directory,'Recovered location',path.basename(f.a.storage.root)),moves=new ProjectMoves(f.registry);await mkdir(path.dirname(destination));
 await assert.rejects(moves.run(f.a.id,f.a.vault,{id,path:destination,checkpoint:async stage=>{if(stage==='frozen')throw Error('Restart before registry adoption');}}),/Restart before registry adoption/);
 assert.equal((await f.registry.locate(f.a.id)).root,f.a.storage.root);
 const opened=await result(await f.project(f.a,'research/records/writing/read',target(f.a)));assert.equal(opened.value.body,f.a.book.entries[0].body);
 assert.equal((await f.registry.locate(f.a.id)).root,destination);
 assert.equal((await result(await f.project(f.a,'storage/move/resume',{id}))).phase,'complete');
});


test('the paged project directory reads summaries and hierarchy while every project database is unavailable',async t=>{
 const f=await fixture(t,{nested:true});await result(await f.project(f.b,'directory/reparent',{id:randomUUID(),parentId:f.a.id,expectedParentId:null}));
 const {ProjectStorage}=await import('../src/project-storage.js'),outline=ProjectStorage.prototype.outline;ProjectStorage.prototype.outline=async()=>{throw Error('A directory request must not open a project database');};
 try{
  const root=await result(await f.call('/api/projects/list',{offset:0,limit:1,parentId:null,revision:null}));assert.equal(root.total,2);assert.equal(root.projects.length,1);assert.equal(root.projects[0].summary.title,f.a.book.projects[0].title);
  const children=await result(await f.call('/api/projects/list',{offset:0,limit:50,parentId:f.a.id,revision:null}));assert.deepEqual(children.projects.map(entry=>entry.projectId),[f.b.id]);assert.deepEqual(children.ancestors.map(entry=>entry.projectId),[f.a.id]);
  await result(await f.call('/api/projects/list',{offset:0,limit:50,parentId:randomUUID(),revision:null}),404);
 }finally{ProjectStorage.prototype.outline=outline;}
});


test('project hierarchy placement is independent, retryable and rejects cycles and stale parent changes',async t=>{
 const f=await fixture(t,{nested:true}),before=(await f.b.storage.outline()).etag;
 const command={id:randomUUID(),parentId:f.a.id,expectedParentId:null},placed=await result(await f.project(f.b,'directory/reparent',command));assert.equal(placed.project.parentId,f.a.id);
 assert.deepEqual(await result(await f.project(f.b,'directory/reparent',command)),placed);assert.equal(placed.project.root,path.join(f.a.storage.root,'b'));assert.equal((await result(await f.project(f.b,'workspace/read/start',{}))).etag,before);
 await result(await f.project(f.a,'directory/reparent',{id:randomUUID(),parentId:f.b.id,expectedParentId:null}),422);
 await result(await f.project(f.b,'directory/reparent',{id:randomUUID(),parentId:null,expectedParentId:f.locked.id}),409);
 assert.equal((await f.registry.locate(f.b.id)).parentId,f.a.id);
});


test('project choice search stays read-only while the workspace writer is held and every project database is unavailable',async t=>{
 const f=await fixture(t),{ProjectStorage}=await import('../src/project-storage.js'),original=ProjectStorage.prototype.openCatalogue;
 let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),holding=f.workspace.withLock(async()=>{entered();await gate;});await ready;
 ProjectStorage.prototype.openCatalogue=async()=>{throw Error('Choice search opened a database');};
 try{
  const data={kind:'parents',exclude:null,query:'',offset:0,limit:1,revision:null},first=await result(await f.call('/api/projects/choices',data));assert.equal(first.total,4);assert.equal(first.projects.length,1);
  const next=await result(await f.call('/api/projects/choices',{...data,offset:1,revision:first.revision}));assert.notEqual(next.projects[0].projectId,first.projects[0].projectId);
  const all=await result(await f.call('/api/projects/choices',{...data,limit:50}));assert.deepEqual(new Set(all.projects.map(p=>p.projectId)),new Set([f.a.id,f.b.id,f.locked.id,(await f.workspace.outline()).metadata.projects[0].id]));
  await result(await f.call('/api/projects/choices',{...data,revision:'outdated'}),409);await result(await f.call('/api/projects/choices',{...data,limit:51}),422);
  assert.equal((await f.activity()).operations.filter(op=>['running','queued'].includes(op.state)).length,0);
 }finally{ProjectStorage.prototype.openCatalogue=original;release();await holding;}
});


test('HTTP project opening unlocks only the chosen owner without joining the workspace writer and resolves its failed attempt',async t=>{
 const f=await fixture(t),command={id:randomUUID(),path:f.locked.storage.root,username:'',password:'Wrong password',recovery:''};let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),holding=f.workspace.withLock(async()=>{entered();await gate;});await ready;
 try{
  await result(await f.call('/api/projects/open',command),401);const before=(await f.registry.read()).revision;
  const opened=await result(await f.call('/api/projects/open',{...command,password:'A separate project password'}));assert.equal(opened.project.projectId,f.locked.id);assert.equal((await f.registry.read()).revision,before);
  assert.equal((await result(await f.project(f.locked,'research/records/writing/read',target(f.locked)))).value.body,f.locked.book.entries[0].body);
  const operations=(await f.activity()).operations.filter(item=>item.kind==='/api/projects/open');assert.equal(operations.length,2);assert.ok(operations.find(item=>item.state==='failed').resolvedAt);assert.ok(!operations.some(item=>['queued','running'].includes(item.state)));
 }finally{release();await holding;}
});


test('locking an identified project cancels its in-flight opening before session authorization',async t=>{
 const f=await fixture(t),{ProjectOpening}=await import('../src/project-opening.js'),original=ProjectOpening.prototype.open;let release,entered,pending;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 ProjectOpening.prototype.open=function(command,options){return original.call(this,command,{...options,checkpoint:async stage=>{if(stage==='read'){entered();await gate;}}});};
 try{
  pending=f.call('/api/projects/open',{id:randomUUID(),path:f.locked.storage.root,username:'',password:'A separate project password',recovery:''});await ready;
  await result(await f.project(f.locked,'access/lock'));release();await result(await pending,401);await result(await f.project(f.locked,'research/records/writing/read',target(f.locked)),401);
  await result(await f.project(f.b,'research/records/writing/read',target(f.b)));
 }finally{release();ProjectOpening.prototype.open=original;if(pending)await pending.catch(()=>{});}
});


test('HTTP database admission cancels disconnected reads and does not delay another project writer',async t=>{
 const f=await fixture(t),connections=[],controller=new AbortController();let pending;
 try{
  for(let i=0;i<databaseCapacity().limit;i++)connections.push(await f.a.storage.openCatalogue());
  pending=f.project(f.a,'research/records/writing/read',target(f.a),{}, {signal:controller.signal});const cancelled=assert.rejects(pending,{name:'AbortError'});
  for(let i=0;i<200&&databaseCapacity().queued===0;i++)await delay(10);assert.equal(databaseCapacity().queued,1);
  const current=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));
  await result(await f.project(f.b,'research/records/writing/save',{...target(f.b),expectedRevision:current.revision,value:{body:'Sibling writes during admission pressure'}}));
  assert.equal((await result(await f.project(f.b,'research/records/writing/read',target(f.b)))).value.body,'Sibling writes during admission pressure');
  assert.equal(databaseCapacity().queued,1);controller.abort();await cancelled;
  for(let i=0;i<200&&databaseCapacity().queued;i++)await delay(10);assert.equal(databaseCapacity().queued,0);
  const activity=await f.activity();assert.equal(activity.operations.filter(entry=>['running','queued'].includes(entry.state)).length,0);
 }finally{controller.abort();await pending?.catch(()=>{});await Promise.all(connections.map(db=>db.close()));}
 assert.equal(databaseCapacity().active,0);assert.equal(databaseCapacity().admitted,0);
});


test('HTTP project deletion authenticates its owner and preserves sibling authoring while cleanup runs',async t=>{
 const f=await fixture(t),id=randomUUID(),before=await f.b.storage.read(),stop=ProjectDeletions.prototype.stopDatabase;let release,entered,operation;
 const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 try{
  const denied=await f.project(f.locked,'storage/delete',{id:randomUUID(),expectedRoot:f.locked.storage.root});assert.notEqual(denied.status,200);assert.equal((await denied.json()).projectId,f.locked.id);
  await result(await f.project(f.a,'storage/delete',{id,expectedRoot:f.b.storage.root}),409);
  ProjectDeletions.prototype.stopDatabase=async function(...args){if(this.projectId===f.a.id){entered();await held;}return stop.apply(this,args);};
  operation=f.project(f.a,'storage/delete',{id,expectedRoot:f.a.storage.root});await ready;
  const pending=await result(await f.call('/api/projects/delete/pending',{after:null,limit:20}));assert.equal(pending.items[0].projectId,f.a.id);assert.equal(pending.items[0].running,true);
  const status=await result(await f.project(f.a,'storage/delete/status'));assert.equal(status.deletion.phase,'frozen');
  const observed=(await f.activity()).operations.find(entry=>entry.kind==='/api/projects/'+f.a.id+'/storage/delete'&&entry.state==='running');assert.equal(observed?.state,'running');assert.equal(observed.view,'#/projects');assert.equal(observed.progress.stage,'delete-database');
  const reference=await f.call('/api/projects/reference-location',{workspaceId:f.a.book.id,kind:'record',id:f.a.book.entries[0].id});assert.notEqual(reference.status,200);assert.equal((await reference.json()).code,'PROJECT_DELETED');
  const writing=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));await result(await f.project(f.b,'research/records/writing/save',{...target(f.b),expectedRevision:writing.revision,value:{body:'Saved during sibling deletion'}}));
  release();assert.equal((await result(await operation)).complete,true);assert.equal((await result(await f.project(f.a,'storage/delete',{id,expectedRoot:f.a.storage.root}))).complete,true);
  assert.equal((await result(await f.project(f.b,'research/records/writing/read',target(f.b)))).value.body,'Saved during sibling deletion');assert.equal((await result(await f.call('/api/projects/delete/pending',{after:null,limit:20}))).items.length,0);
  assert.equal((await f.b.storage.read()).book.id,before.book.id);
  const cleanupId=randomUUID();await assert.rejects(new ProjectDeletions(f.registry,f.locked.id).run(f.locked.vault,{id:cleanupId,checkpoint:async stage=>{if(stage==='removed')throw Error('Lost completion');}}),/Lost completion/);
  await mkdir(f.locked.storage.root);await writeFile(path.join(f.locked.storage.root,'replacement.txt'),'Keep this new folder');
  assert.equal((await result(await f.project(f.locked,'storage/delete/resume',{id:cleanupId,username:'',password:'',recovery:''}))).complete,true);assert.equal(await readFile(path.join(f.locked.storage.root,'replacement.txt'),'utf8'),'Keep this new folder');
 }finally{release();ProjectDeletions.prototype.stopDatabase=stop;if(operation)await operation.catch(()=>{});}
});


test('HTTP legacy project references use indexed owners and retain project authorization',async t=>{
 const f=await fixture(t),{ProjectReferenceAliases}=await import('../src/project-reference-aliases.js'),aliases=new ProjectReferenceAliases(f.workspace),sourceNamespace=f.registry.workspaceId,selected=f.a.book.entries[0],reference={workspaceId:sourceNamespace,kind:'record',id:selected.id,revision:recordRevision(selected)},current=await f.registry.read();
 const root=await aliases.prepare(null,{version:1,sourceNamespace,namespaceId:f.a.book.id,projectId:f.a.id},[{kind:'project',id:f.a.id},{kind:'notebook',id:selected.notebookId},{kind:'record',id:selected.id}]);
 await f.registry.change(current.revision,value=>({...value,aliases:root}));
 let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),busy=f.workspace.withLock(async()=>{entered();await gate;});await ready;
 try{
  const located=await result(await f.call('/api/projects/reference-location',reference));assert.equal(located.projectId,f.a.id);assert.equal(located.namespaceId,f.a.book.id);assert.deepEqual(located.target,reference);
  const resolved=await result(await f.call('/api/projects/reference',reference));assert.equal(resolved.value.body,selected.body);assert.equal(resolved.revision,reference.revision);
  await result(await f.project(f.a,'access/lock'));const denied=await result(await f.call('/api/projects/reference',reference),401);assert.equal(denied.projectId,f.a.id);
  assert.deepEqual(await result(await f.call('/api/projects/reference-location',{...reference,id:randomUUID()})),{registered:false});
 }finally{release();await busy;}
});


test('HTTP domain commands and summary reads bypass unrelated writers and keep credentials scoped',async t=>{
 const f=await fixture(t),{ProjectModuleCommands}=await import('../src/project-module-commands.js'),{ProjectDomains}=await import('../src/project-domains.js');
 await new ProjectModuleCommands(f.a.storage,f.a.book.id).initialize();await new ProjectModuleCommands(f.b.storage,f.b.book.id).initialize();
 const command={workspaceId:f.a.book.id,commandId:randomUUID(),action:'calculation.save',payload:{id:randomUUID(),expectedRevision:null,data:{name:'HTTP owned calculation',links:[],engine:1,mode:'expression',angle:'rad',expression:'6*7',digits:'',fromBase:10,toBase:16}}};
 const db=await f.a.storage.openCatalogue();await db.run('BEGIN');await db.lock();
 try{
  const saved=await result(await f.project(f.a,'modules/command',command));assert.deepEqual(saved.revisions,{calculator:1});assert.equal(saved.replayed,false);
  const page=await result(await f.project(f.a,'modules/items',{workspaceId:f.a.book.id,type:'calculation'}));assert.equal(page.items[0].id,command.payload.id);assert.deepEqual(page.revisions,{calculator:1});
  assert.equal((await result(await f.project(f.a,'modules/command',command))).replayed,true);
  await result(await f.project(f.b,'modules/command',command),409);
  const checkpoint={workspaceId:f.a.book.id,moduleId:'scientific-calculator',id:randomUUID(),etag:null,drafts:[{id:command.payload.id,type:'calculation',expectedRevision:1,baseRevision:1,data:{...command.payload.data,name:'Retained independently'}}]};
  const savedDraft=await result(await f.project(f.a,'modules/drafts/write',checkpoint));assert.ok(savedDraft.etag);
  const recovered=await result(await f.project(f.a,'modules/drafts/read',{workspaceId:f.a.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id}));assert.deepEqual(recovered.draft.drafts[0].base,command.payload.data);
  assert.equal((await result(await f.project(f.a,'modules/drafts/list',{workspaceId:f.a.book.id,moduleId:checkpoint.moduleId}))).drafts.length,1);
  assert.equal((await result(await f.project(f.b,'modules/drafts/list',{workspaceId:f.b.book.id,moduleId:checkpoint.moduleId}))).drafts.length,0);
 }finally{await db.close();}
 let enter,release;const ready=new Promise(resolve=>enter=resolve),hold=new Promise(resolve=>release=resolve),writing=new ProjectDomains(f.a.storage,f.a.book.id).run(['calculator'],async()=>{enter();await hold;},{write:['calculator']});await ready;
 let pending;
 try{
  const calendar={workspaceId:f.a.book.id,commandId:randomUUID(),action:'calendar.save',payload:{id:randomUUID(),expectedRevision:null,data:{name:'While calculator is busy',projectId:f.a.id,color:'#123456',archived:false}}};
  assert.deepEqual((await result(await f.project(f.a,'modules/command',calendar))).revisions,{calendars:1});
  assert.equal((await result(await f.project(f.a,'modules/item',{workspaceId:f.a.book.id,id:command.payload.id}))).entity.revision,1);
  const namespace={workspaceId:f.a.book.id};
  assert.equal((await result(await f.project(f.a,'modules/version',namespace))).revisions.calendars,1);
  assert.deepEqual((await result(await f.project(f.a,'modules/planning/dashboard',{...namespace,type:'calendar'}))).revisions,{calendars:1});
  assert.equal((await result(await f.project(f.a,'modules/inventory/dashboard',{...namespace,type:'resource'}))).total,0);
  const schedule=await result(await f.project(f.a,'calendars/page',{...namespace,from:'2026-10-01',to:'2026-11-01'}));assert.equal(schedule.total,0);
  await result(await f.project(f.b,'calendars/page',{...namespace,from:'2026-10-01',to:'2026-11-01'}),409);

  const history=await result(await f.project(f.a,'modules/history/page',{workspaceId:f.a.book.id,id:command.payload.id,limit:2}));assert.equal(history.total,1);
  assert.equal((await result(await f.project(f.a,'modules/history/read',{workspaceId:f.a.book.id,id:command.payload.id,revision:1}))).entity.data.expression,'6*7');
  await result(await f.project(f.b,'modules/history/page',{workspaceId:f.a.book.id,id:command.payload.id}),409);
  pending=f.project(f.a,'modules/command',{...command,commandId:randomUUID(),payload:{...command.payload,expectedRevision:1,data:{...command.payload.data,name:'Must not save after lock'}}});
  const deadline=Date.now()+10000;while(!(await f.activity()).operations.some(op=>op.kind.includes(f.a.id)&&op.state==='queued')){if(Date.now()>deadline)throw Error('Command never reached its own writer queue');await delay(25);}
  await result(await f.project(f.a,'access/lock'));await result(await pending,401);
  assert.equal((await result(await f.project(f.b,'modules/items',{workspaceId:f.b.book.id,type:'calculation'}))).total,0);
 }finally{release();await writing;if(pending)await pending.catch(()=>{});}
 await result(await f.project(f.a,'access/unlock'));
 assert.equal((await result(await f.project(f.a,'modules/item',{workspaceId:f.a.book.id,id:command.payload.id}))).entity.data.name,command.payload.data.name);
 assert.ok(!(await f.activity()).operations.some(op=>['queued','running'].includes(op.state)));
});


test('project evidence uploads, background verification and original streams stay with their selected owner',async t=>{
 const f=await fixture(t),bytes=Buffer.from('Original project observation\n1,2,3\n'),prefix='/api/projects/'+f.a.id+'/research/materials/';
 const started=await result(await f.project(f.a,'research/materials/start',{recordId:f.a.book.entries[0].id,name:'measurements.csv',size:bytes.length}));
 await result(await f.raw(prefix+'chunk/'+started.id+'/0',{method:'POST',bytes,headers:{'Content-Type':'application/octet-stream'}}));
 await result(await f.project(f.a,'research/materials/finish',{id:started.id}),202);
 let job;const end=Date.now()+15000;
 do{job=(await result(await f.project(f.a,'research/materials/job',{id:started.id}))).job;if(['completed','failed'].includes(job.state))break;await delay(30);}while(Date.now()<end);
 assert.equal(job.state,'completed',JSON.stringify(job));
 const ref=job.result,doc=await result(await f.project(f.a,'research/materials/read',{ref}));assert.equal(doc.recordId,f.a.book.entries[0].id);
 const readiness=await result(await f.project(f.a,'v1/intake/readiness',{version:1,workspaceId:f.a.book.id,recordId:f.a.book.entries[0].id}));assert.equal(readiness.counts.artifacts,1);
 assert.notEqual((await f.project(f.b,'v1/intake/readiness',{version:1,workspaceId:f.a.book.id,recordId:f.a.book.entries[0].id})).status,200);
 const download=prefix+'original/'+ref.id+'/'+ref.revision+'?context='+f.context;
 const response=await f.raw(download);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 const range=await f.raw(download,{headers:{Range:'bytes=9-15'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(9,16));
 const posted=await f.project(f.a,'research/materials/download',{ref});assert.equal(posted.status,200);assert.deepEqual(Buffer.from(await posted.arrayBuffer()),bytes);
 assert.equal((await f.raw(download.replace(f.context,'wrong'))).status,409);
 assert.notEqual((await f.raw(download.replace(f.a.id,f.b.id))).status,200);
 assert.notEqual((await f.project(f.b,'research/materials/job',{id:started.id})).status,200);
 assert.notEqual((await f.call('/api/research/materials/read',{ref})).status,200);
 await result(await f.project(f.a,'access/lock'));assert.equal((await f.raw(download)).status,401);
 await result(await f.project(f.b,'research/records/writing/read',target(f.b)));
 await result(await f.project(f.a,'access/unlock'));const reopened=await f.raw(download);assert.equal(reopened.status,200);assert.deepEqual(Buffer.from(await reopened.arrayBuffer()),bytes);
});

test('project evidence work survives request completion and pauses on project lock without blocking siblings',async t=>{
 const f=await fixture(t),bytes=Buffer.from('An interrupted project original'),prepare=ResearchMaterials.prototype.prepareImport;let allow=false,entered;const ready=new Promise(resolve=>entered=resolve);
 ResearchMaterials.prototype.prepareImport=async function(id,options){if(this.workspace.projectId===f.a.id){entered();if(!allow)await delay(60000,null,{signal:options.signal});}return prepare.call(this,id,options);};
 t.after(()=>{ResearchMaterials.prototype.prepareImport=prepare;});
 const session=await new ResearchMaterials(f.a.storage).startImport({recordId:f.a.book.entries[0].id,name:'paused.bin',size:bytes.length});await new ResearchMaterials(f.a.storage).appendImport(session.id,0,[bytes]);
 await result(await f.project(f.a,'research/materials/finish',{id:session.id}),202);await ready;
 assert.equal((await result(await f.project(f.a,'research/materials/job',{id:session.id}))).job.state,'running');
 const b=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));await result(await f.project(f.b,'research/records/writing/save',{...target(f.b),expectedRevision:b.revision,value:{body:'Sibling work continued'}}));
 await result(await f.project(f.a,'access/lock'));assert.equal((await f.project(f.a,'research/materials/job',{id:session.id})).status,401);
 allow=true;await result(await f.project(f.a,'access/unlock'));let job;const end=Date.now()+15000;
 do{job=(await result(await f.project(f.a,'research/materials/job',{id:session.id}))).job;if(['completed','failed'].includes(job.state))break;await delay(30);}while(Date.now()<end);
 assert.equal(job.state,'completed',JSON.stringify(job));assert.equal(job.attempt,2);
 assert.equal((await result(await f.project(f.b,'research/records/writing/read',target(f.b)))).value.body,'Sibling work continued');
});


test('addressed evidence routes admit exact read commands without mutation or implicit owners',()=>{
 for(const name of ['read','record','references','schema','rows','retained-table','calculation-schema','analysis-status','download']){
  const request=projectMaterialReferenceRequest('/api/projects/material-reference/'+name);assert.equal(request.write,false);assert.equal(request.referenceOwner,true);assert.equal(request.method,'POST');
 }
 for(const name of ['analysis','collection','pin','measurement-save','start','finish','chunk','verify','read/extra'])assert.equal(projectMaterialReferenceRequest('/api/projects/material-reference/'+name),null);
 const ref={kind:'artifact',id:randomUUID(),revision:'a'.repeat(64),workspaceId:randomUUID()};
 assert.deepEqual(addressedMaterialReference({ref:{...ref,label:'Presentation only'}}),ref);
 for(const workspaceId of [undefined,null,'',false,randomUUID()+'/../x'])assert.throws(()=>addressedMaterialReference({ref:{...ref,workspaceId}}),{code:'INVALID'});
});

test('addressed evidence reads enforce the owning project grant and retain exact bytes after relocation',async t=>{
 const f=await fixture(t,{nested:true}),bytes=Buffer.from('Independent evidence address\n5,8,13\n'),materials=new ResearchMaterials(f.b.storage);
 const upload=await materials.startImport({recordId:f.b.book.entries[0].id,name:'addressed.csv',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);
 const artifact=await materials.finishImport(upload.id),ref={...artifact,workspaceId:f.b.book.id},read=(operation,data={ref})=>f.call('/api/projects/material-reference/'+operation,data);
 const rootRef={workspaceId:f.book.id,kind:'record',id:f.book.entries[0].id,revision:recordRevision(f.book.entries[0])};
 const root=await result(await read('record',{ref:rootRef}));assert.equal(root.projectId,null);assert.equal(root.value.previous.record.id,rootRef.id);
 const db=await f.a.storage.openCatalogue();
 try{
  await db.run('BEGIN');await db.lock();
  const found=await result(await read('read'));assert.equal(found.projectId,f.b.id);assert.equal(found.namespaceId,f.b.book.id);assert.equal(found.value.id,ref.id);assert.equal(found.value.recordId,f.b.book.entries[0].id);
  const response=await read('download');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const original='/api/projects/material-reference/original/'+ref.workspaceId+'/'+ref.id+'/'+ref.revision+'?context='+f.context;
  const range=await f.raw(original,{headers:{Range:'bytes=2-9'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(2,10));
  assert.equal((await f.raw(original.replace(f.context,'wrong'))).status,409);
  assert.notEqual((await f.project(f.a,'research/materials/read',{ref})).status,200);
  const recordRef={workspaceId:f.b.book.id,kind:'record',id:f.b.book.entries[0].id,revision:recordRevision(f.b.book.entries[0])};
  assert.equal((await result(await read('record',{ref:recordRef}))).value.previous.record.id,recordRef.id);
 }finally{await db.close();}
 const lockedRef={workspaceId:f.locked.book.id,kind:'record',id:f.locked.book.entries[0].id,revision:recordRevision(f.locked.book.entries[0])};
 const denied=await read('record',{ref:lockedRef});assert.notEqual(denied.status,200);assert.equal((await denied.json()).projectId,f.locked.id);
 await result(await f.project(f.locked,'access/unlock',{password:'A separate project password'}));assert.equal((await result(await read('record',{ref:lockedRef}))).projectId,f.locked.id);
 await result(await f.project(f.b,'access/lock'));assert.equal((await result(await read('read'),401)).projectId,f.b.id);
 assert.equal((await result(await read('record',{ref:lockedRef}))).projectId,f.locked.id);
 await result(await f.project(f.b,'access/unlock'));
 await result(await read('read',{ref:{...ref,workspaceId:undefined}}),422);
 await result(await read('read',{ref:{...ref,workspaceId:randomUUID()}}),404);
 assert.equal((await result(await read('read',{ref:{...ref,id:randomUUID()}}),422)).code,'MATERIAL_MISSING');
 const destination=path.join(f.a.storage.root,path.basename(f.b.storage.root));await result(await f.project(f.b,'storage/move',{id:randomUUID(),parentId:f.a.id,expectedParentId:null}));
 await f.owner.closeProject(destination);
 const reopened=await read('download');assert.equal(reopened.status,200);assert.deepEqual(Buffer.from(await reopened.arrayBuffer()),bytes);
 const receipt=await result(await f.project(f.b,'storage/delete',{id:randomUUID(),expectedRoot:destination}));assert.ok(receipt);
 assert.notEqual((await read('read')).status,200);
 assert.ok(!(await f.activity()).operations.some(item=>['queued','running'].includes(item.state)));
});


test('project websites publish selected editions while unrelated owners remain writable',{timeout:180000},async t=>{
 const f=await fixture(t),sourceHead=(await f.workspace.outline()).etag,sourceDb=await f.workspace.openCatalogue();let release;
 try{
  await sourceDb.run('BEGIN');await sourceDb.lock();
  const created=await result(await f.project(f.a,'websites/change',{workspaceId:f.a.book.id,etag:(await f.a.storage.outline()).etag,operation:'create',name:'Independent research website',projectId:f.a.id})),site=created.id;
  const opened=await result(await f.project(f.a,'websites/open',{id:site}));
  const edit={workspaceId:f.a.book.id,baseEtag:opened.etag,metadata:{website:{...opened.book.website,footer:'PROJECT_A_PUBLIC_FOOTER'}},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:f.a.book.entries[0].id,share:true,attachments:[]}]}};
  const saved=await result(await f.project(f.a,'websites/save',{id:site,command:edit})),headers={'X-Observanda-Website':site};
  const settings=await result(await f.raw('/api/projects/'+f.a.id+'/publishing',{headers}));
  await result(await f.project(f.a,'publishing/save',{config:{...settings.config,github:{...settings.config.github,owner:'Example',repository:'independent-project'}},etag:settings.etag},headers));
  assert.equal((await result(await f.raw('/api/projects/'+f.b.id+'/publishing'))).configured,false);
  assert.deepEqual((await result(await f.project(f.a,'website/research/summary',{workspaceId:f.a.book.id,snapshotId:saved.etag,selection:edit.selection,search:''},headers))).entries,1);
  let entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),prepare=PublicationJobs.prototype.prepare;
  t.mock.method(PublicationJobs.prototype,'prepare',async function(...args){if(this.workspace.projectId===f.a.id){entered();await gate;}return prepare.apply(this,args);});
  const started=await result(await f.project(f.a,'publication-jobs/start',{etag:saved.etag},headers));await ready;
  const b=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));await result(await f.project(f.b,'research/records/writing/save',{...target(f.b),expectedRevision:b.revision,value:{body:'B authoring continues during A publication'}}));
  assert.equal((await f.workspace.outline()).etag,sourceHead);release();
  let job=started.job;const deadline=Date.now()+60000;
  while(['queued','running'].includes(job.state)){if(Date.now()>deadline)throw Error('Project publication did not finish');await delay(100);job=(await result(await f.project(f.a,'publication-jobs/status',{id:job.id},headers))).job;}
  assert.equal(job.state,'completed',JSON.stringify(job));
  const edition=await result(await f.project(f.a,'publication-jobs/open',{id:job.result.id},headers));assert.ok(edition.url.startsWith('/api/projects/'+f.a.id+'/publication-preview/'));
  const page=await f.raw(edition.url);assert.equal(page.status,200);assert.match(await page.text(),/PROJECT_A_PUBLIC_FOOTER/);
  const archive=await f.raw('/api/projects/'+f.a.id+'/export/'+edition.id);assert.equal(archive.status,200,await archive.clone().text());assert.equal(archive.headers.get('content-type'),'application/zip');assert.equal(Buffer.from(await archive.arrayBuffer()).subarray(0,2).toString(),'PK');
  await result(await f.raw(edition.url.replace(f.a.id,f.b.id)),404);
  await result(await f.project(f.b,'publication-jobs/open',{id:edition.id}),404);
  const prior=(await result(await f.project(f.a,'websites/open',{id:site}))).book.website.footer;assert.equal(prior,'PROJECT_A_PUBLIC_FOOTER');
  await result(await f.project(f.a,'access/lock'));await result(await f.raw(edition.url),401);await result(await f.project(f.a,'access/unlock'));assert.equal((await f.raw(edition.url)).status,200);
  assert.equal((await result(await f.project(f.b,'research/records/writing/read',target(f.b)))).value.body,'B authoring continues during A publication');
 }finally{release?.();await sourceDb.close();}
});


test('project publication assets retain font bytes and original downloads under their own grants',{timeout:150000},async t=>{
 const f=await fixture(t),db=await f.workspace.openCatalogue(),fontBytes=await (await import('node:fs/promises')).readFile(new URL('../src/fonts/dm-sans.ttf',import.meta.url)),prefix='/api/projects/'+f.a.id;
 try{
  await db.run('BEGIN');await db.lock();
  const font=await result(await f.raw(prefix+'/fonts/import?embed=true',{method:'POST',bytes:fontBytes,headers:{'Content-Type':'application/octet-stream'}}));
  assert.deepEqual((await result(await f.raw(prefix+'/fonts'))).map(v=>v.id),[font.id]);assert.deepEqual(await result(await f.raw('/api/projects/'+f.b.id+'/fonts')),[]);
  const content=await f.raw(prefix+'/fonts/'+font.id+'?workspace='+f.context);assert.equal(content.status,200);assert.deepEqual(Buffer.from(await content.arrayBuffer()),fontBytes);
  await result(await f.raw(prefix+'/fonts/'+font.id+'?workspace=wrong'),409);await result(await f.raw('/api/projects/'+f.b.id+'/fonts/'+font.id+'?workspace='+f.context),422);
  await result(await f.project(f.a,'fonts/update',{id:font.id,embed:false,hidden:true}));assert.equal((await result(await f.raw(prefix+'/fonts')))[0].embed,false);
  const bytes=Buffer.from('Independent project downloadable observations'),session=await result(await f.project(f.a,'media-imports/start',{name:'observations.txt',kind:'file',size:bytes.length}));
  await result(await f.raw(prefix+'/media-imports/receive/'+session.id,{method:'POST',bytes,headers:{'Content-Type':'application/octet-stream'}}));
  const original=await f.raw(prefix+'/media-imports/original/'+session.id+'?context='+f.context);assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  let job=(await result(await f.project(f.a,'media-imports/finish',{id:session.id}))).job;const deadline=Date.now()+30000;while(['queued','running'].includes(job.state)){if(Date.now()>deadline)throw Error('Project file preparation did not finish');await delay(100);job=(await result(await f.project(f.a,'media-imports/job',{id:job.id}))).job;}
  assert.equal(job.state,'completed',JSON.stringify(job));const prepared=await f.raw(prefix+'/media/'+job.result.id);assert.equal(prepared.status,200);assert.deepEqual(Buffer.from(await prepared.arrayBuffer()),bytes);
  assert.equal((await result(await f.project(f.b,'media-imports/list',{cursor:null}))).items.length,0);
  await result(await f.project(f.a,'access/lock'));await result(await f.raw(prefix+'/media/'+job.result.id),401);await result(await f.project(f.a,'access/unlock'));assert.equal((await f.raw(prefix+'/media/'+job.result.id)).status,200);
  const b=await result(await f.project(f.b,'research/records/writing/read',target(f.b)));assert.ok(b.revision);
 }finally{await db.close();}
});


test('project deployment jobs use their own publisher and preserve sibling configuration',{timeout:150000},async t=>{
 const remote=githubFixture({branch:'main',repository:'project-site',initialFiles:{'README.md':'Existing independent destination'}}),f=await fixture(t,{publishingOptions:{request:remote.request}});
 const prefix='/api/projects/'+f.a.id,settings=await result(await f.raw(prefix+'/publishing'));
 const configured=await result(await f.project(f.a,'publishing/save',{config:{...settings.config,github:{...settings.config.github,owner:'example',repository:'project-site',branch:'main'}},etag:settings.etag}));
 await result(await f.project(f.a,'publishing/connect',{token:'fixture_project_token_1234567890'}));
 assert.equal((await result(await f.raw('/api/projects/'+f.b.id+'/publishing'))).connected,false);
 const edition=await result(await f.project(f.a,'preview',{etag:(await f.a.storage.outline()).etag}));
 const plan=await result(await f.project(f.a,'publishing/plan',{id:edition.id,configEtag:configured.etag}));
 const started=await result(await f.project(f.a,'deployment-jobs/start',{id:edition.id,configEtag:configured.etag,reviewed:true,destinationReview:plan.id,destinationReviewed:true}));
 let job=started.job;const deadline=Date.now()+45000;while(['queued','running'].includes(job.state)){if(Date.now()>deadline)throw Error('Project deployment did not finish');await delay(100);job=(await result(await f.project(f.a,'deployment-jobs/status',{id:job.id}))).job;}
 assert.equal(job.state,'completed',JSON.stringify(job));const own=await result(await f.raw(prefix+'/publishing'));assert.equal(own.receipt.commit,remote.head);assert.equal((await result(await f.raw('/api/projects/'+f.b.id+'/publishing'))).receipt,null);
 await result(await f.project(f.b,'deployment-jobs/status',{id:job.id}),404);assert.ok(remote.calls.some(call=>call.route.includes('/repos/example/project-site/')));
});


test('project template authoring exchange and saved views keep their owner while other databases are busy',async t=>{
 const f=await fixture(t),locks=[];
 try{
  for(const storage of [f.workspace,f.b.storage]){const db=await storage.openCatalogue();locks.push(db);await db.run('BEGIN');await db.lock();}
  const workspaceId=f.a.book.id,id=randomUUID(),request=(operation,data={})=>f.project(f.a,'research/starters/'+operation,{workspaceId,...data});
  const draft={name:'Repeatable owned method',title:'New instrument trial',type:'experiment',body:'Measure after calibration',tags:[],sections:[{title:'Method',body:'Retain exact units'}]};
  const saved=await result(await request('save',{id,expectedRevision:null,draft}));
  const released=await result(await request('publish-selected',{id,expectedRevision:saved.header.revision,note:'Method reviewed'}));
  const release=released.header.latest;
  assert.equal((await result(await request('list',{cursor:null}))).items[0].id,id);
  assert.equal((await result(await request('read',{id}))).draft.body,draft.body);
  await result(await f.project(f.a,'research/starters/list',{workspaceId:f.b.book.id,cursor:null}),409);
  const denied=await result(await f.project(f.locked,'research/starters/list',{workspaceId:f.locked.book.id,cursor:null}),422);assert.equal(denied.code,'DEVICE_UNKNOWN');assert.equal(denied.projectId,f.locked.id);
  await result(await request('download',{id,release,password:'short'}),422);
  const download=await request('download',{id,release,password:'Template exchange password'});
  assert.equal(download.status,200,await download.clone().text());assert.equal(download.headers.get('content-type'),'application/vnd.observanda.template');
  const bytes=Buffer.from(await download.arrayBuffer());assert.ok(bytes.length>0);
  const recordId=randomUUID();await result(await request('create',{id,release,recordId,notebookId:f.a.book.notebooks[0].id}));
  const record=await result(await f.project(f.a,'research/records/writing/read',{workspaceId,recordId,sectionId:null}));assert.equal(record.value.body,draft.body);
  const origin=await result(await request('origin',{recordId}));assert.equal(origin.origin.templateId,id);
  const view={id:randomUUID(),name:'Instrument observations',query:viewQuery({notebook:f.a.book.notebooks[0].id})};
  const savedView=await result(await f.project(f.a,'research/views/save',{workspaceId,expectedRevision:null,view}));
  assert.equal((await result(await f.project(f.a,'research/views/list',{workspaceId}))).views[0].id,view.id);
  await result(await f.project(f.a,'research/views/save',{workspaceId:f.b.book.id,expectedRevision:null,view}),409);
  await result(await f.project(f.a,'research/views/remove',{workspaceId,id:view.id,expectedRevision:savedView.view.revision}));
  assert.deepEqual((await result(await f.project(f.a,'research/views/list',{workspaceId}))).views,[]);
  for(const db of locks)await db.run('ROLLBACK');
  const upload=await result(await f.project(f.b,'research/starters/upload',{workspaceId:f.b.book.id,uploadId:randomUUID(),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
  const command={workspaceId:f.b.book.id,uploadId:upload.uploadId};
  for(let offset=0,index=0;offset<bytes.length;offset+=upload.chunkBytes,index++)await result(await f.project(f.b,'research/starters/uploadPart',{...command,index,encoded:bytes.subarray(offset,offset+upload.chunkBytes).toString('base64')}));
  const review=await result(await f.project(f.b,'research/starters/review',{...command,password:'Template exchange password'}));
  const importedId=randomUUID();await result(await f.project(f.b,'research/starters/accept',{...command,id:importedId,fingerprint:review.fingerprint}));
  assert.deepEqual((await result(await f.project(f.b,'research/starters/list',{workspaceId:f.b.book.id,cursor:null}))).items.map(item=>item.id),[importedId]);
  assert.deepEqual((await result(await request('list',{cursor:null}))).items.map(item=>item.id),[id]);
  assert.deepEqual((await result(await f.call('/api/research/starters/list',{workspaceId:f.book.id,cursor:null}))).items,[]);
  assert.deepEqual((await result(await f.call('/api/research/views/list',{workspaceId:f.book.id}))).views,[]);
  assert.ok(!(await f.activity()).operations.some(item=>['queued','running'].includes(item.state)));
 }finally{for(const db of locks)await db.close();}
});


test('project draft transfer and conflict recovery stay independent of workspace and sibling writers',async t=>{
 const f=await fixture(t),base=f.a.book.entries[0],mine={...base,title:'Recovered independent experiment',body:'Owned draft instructions. '.repeat(1000),sections:[...base.sections,...Array.from({length:50},(_,index)=>({id:randomUUID(),title:'Observation '+index,body:'Measurement notes. '.repeat(180)}))]},id=randomUUID(),workspaceId=f.a.book.id,revision=recordRevision(base),bytes=Buffer.from(JSON.stringify([{baseRevision:revision,expectedRevision:revision,record:mine}])),hash=body=>createHash('sha256').update(body).digest('hex'),sha256=hash(bytes);
 let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),held=f.workspace.withLock(async()=>{entered();await gate;});await ready;
 const sibling=await f.b.storage.openCatalogue();await sibling.run('BEGIN');await sibling.lock();
 const command=(route,data)=>f.project(f.a,'research/drafts/'+route,data).then(result);
 try{
  assert.equal((await command('transfer/start',{id,workspaceId,expectedRevision:null,bytes:bytes.length,sha256})).receivedChunks,0);
  for(let offset=0,index=0;offset<bytes.length;offset+=RECORD_DRAFT_CHUNK_BYTES,index++){
   const part=bytes.subarray(offset,offset+RECORD_DRAFT_CHUNK_BYTES),data={id,workspaceId,transferHash:sha256,index,bytes:part.toString('base64'),sha256:hash(part)};
   await command('transfer/part',data);if(index===0)await command('transfer/part',data);
  }
  const finish={id,workspaceId,transferHash:sha256},receipt=await command('transfer/finish',finish);assert.deepEqual(await command('transfer/finish',finish),receipt);
  const header=await command('read',{id,summary:true}),draft={id,workspaceId,expectedRevision:header.revision};assert.equal(header.draft.titles[0],mine.title);
  assert.equal((await command('content',{...draft,offset:0})).title,mine.title);
  const part=await command('transfer/readPart',{...draft,index:1});assert.equal(hash(Buffer.from(part.bytes,'base64')),part.sha256);
  assert.ok((await command('transfer/readBase',draft)).base);
  assert.equal((await command('review/records',{...draft,offset:0})).items[0].recovered,false);
  await result(await f.project(f.b,'research/drafts/read',{id,summary:true}),404);
  await result(await f.project(f.a,'research/drafts/content',{...draft,workspaceId:f.b.book.id,offset:0}),409);
  const before=await result(await f.project(f.a,'research/records/writing/read',target(f.a)));await result(await f.project(f.a,'research/records/writing/save',{...target(f.a),expectedRevision:before.revision,value:{body:'Concurrent saved instructions'}}));
  let plan=await command('review/prepare',draft);const at=()=>({id:plan.id,workspaceId,expectedRevision:plan.revision});assert.equal(plan.count,1);
  assert.equal((await command('review/content',{...at(),offset:0})).title,mine.title);
  const page=await command('review/page',{...at(),offset:0});assert.deepEqual(page.items[0].path,['body']);assert.match((await command('review/value',{...at(),position:0,version:'mine',offset:0})).text,/Owned draft instructions/);
  plan=await command('review/choose',{...at(),position:0,version:'mine'});assert.deepEqual(await command('review/prepare',draft),plan);
  const apply=at(),saved=await command('review/apply',apply);assert.equal(saved.recordId,base.id);assert.deepEqual(await command('review/apply',apply),saved);
  await result(await f.project(f.a,'research/drafts/read',{id,summary:true}),404);
  assert.equal((await result(await f.project(f.a,'research/records/writing/read',target(f.a)))).value.body,mine.body);
  assert.equal((await result(await f.project(f.b,'research/records/writing/read',target(f.b)))).value.body,f.b.book.entries[0].body);
  assert.ok(!(await f.activity()).operations.some(item=>['queued','running'].includes(item.state)));
 }finally{release();await held;await sibling.run('ROLLBACK');await sibling.close();}
});


test('project peer reviews retain their owner and browsing does not acquire a writer',async t=>{
 const f=await fixture(t),reviewer=new ReviewIdentity(new TestDeviceStore({file:path.join(f.directory,'reviewer.key')})),contact=await reviewer.contact();
 const namespace=f.a.book.id,record=f.a.book.entries[0],call=(operation,data={},options={})=>f.project(f.a,'reviews/'+operation,{workspaceId:namespace,...data},{},options);
 const root=await f.workspace.openCatalogue(),sibling=await f.b.storage.openCatalogue();
 try{
  await root.run('BEGIN');await root.lock();await sibling.run('BEGIN');await sibling.lock();
  const identity=await result(await call('identity'));
  await result(await call('contact',{contact,name:'Independent reviewer',verified:true}));
  const plan=await result(await call('plan',{scope:{kind:'record',id:record.id}}));assert.equal(plan.records.length,1);
  const id=randomUUID(),created=await result(await call('create',{id,recipient:reviewHash(contact),message:'Please review this observation',records:plan.records.map(({id,revision})=>({id,revision})),scope:plan.scope}));
  const signed=await reviewer.open(created.file);assert.equal(signed.value.workspaceId,namespace);assert.equal(signed.value.records[0].id,record.id);
  const packet=(await result(await call('read',{id}))).packet;assert.equal(packet.request.value.id,id);
  assert.equal((await result(await f.project(f.b,'reviews/list',{workspaceId:f.b.book.id}))).total,0);
  assert.equal((await result(await f.call('/api/reviews/list',{workspaceId:f.book.id}))).total,0);
  await result(await call('list',{workspaceId:f.b.book.id}),422);
  const db=await f.a.storage.openCatalogue();
  try{
   await db.run('BEGIN');await db.lock();
   const page=await result(await call('list',{recordId:record.id},{signal:AbortSignal.timeout(10000)}));assert.equal(page.total,1);assert.equal(page.items[0].records[0].current,true);
   await result(await call('plan',{scope:{kind:'record',id:record.id}},{signal:AbortSignal.timeout(10000)}));
   assert.ok((await result(await call('export',{id},{signal:AbortSignal.timeout(10000)}))).file);
   assert.equal((await result(await call('read',{id},{signal:AbortSignal.timeout(10000)}))).packet.request.value.id,id);
  }finally{await db.close();}
  const response=await reviewer.sign({kind:'response',id:randomUUID(),requestId:id,requestHash:reviewHash(packet.request),createdAt:new Date().toISOString(),sender:contact,recipient:reviewHash(identity.contact),decisions:[{id:record.id,revision:recordRevision(record),decision:'reviewed',comment:'Retained signed feedback'}]});
  await result(await call('import',{file:await reviewer.seal(response,identity.contact)}));
  assert.equal((await result(await call('list',{recordId:record.id}))).items[0].decisions[0].comment,'Retained signed feedback');
  await result(await f.project(f.a,'access/lock'));await result(await call('list'),401);
  assert.equal((await result(await f.project(f.b,'reviews/list',{workspaceId:f.b.book.id}))).total,0);
 }finally{await root.close();await sibling.close();}
});
