import {assertPrivateCatalogue} from './postgres-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {RecordViews} from '../src/record-views.js';
import {viewQuery,validViewQuery,viewScopeIssue,viewScopeLabel} from '../src/web/record-view-model.js';
import {queryRecords} from '../src/web/record-query.js';
import {queryFixture} from './record-query-fixture.js';
import {createAccess,takeCreatedVault,verifyAccess,readAccess} from '../src/access.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {clearVault} from '../src/encryption.js';
import {buildPublication} from '../src/publication.js';
import {testServer} from './device-fixture.js';

const baseQuery=()=>viewQuery({filter:'all',recordBrowse:{tags:'sound,summer',sort:'date-asc',from:'2026-06-01',to:'2026-06-30'}});
const view=(name='Summer takes',query=baseQuery())=>({id:randomUUID(),name,query});
const command=(book,value,expectedRevision=null)=>({workspaceId:book.id,view:value,expectedRevision});
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-views-')),book=queryFixture(),ws=new Workspace(root);await ws.create(book);
 t.after(()=>rm(root,{recursive:true,force:true}));return {root,book,ws,store:new RecordViews(ws)};
}

test('saved queries retain declared filters, reject malformed scopes and ranges, and query current records',()=>{
 const q=baseQuery();assert.equal(validViewQuery(q),true);
 const book=queryFixture(),before=JSON.stringify(book);
 assert.equal(queryRecords(book.entries,{browse:q.browse}).length,3);
 const bookQuery=viewQuery({notebook:book.notebooks[1].id,project:book.projects[0].id});
 assert.equal(bookQuery.projectId,null);assert.equal(bookQuery.notebookId,book.notebooks[1].id);
 const oldLabel=viewScopeLabel(book,bookQuery);book.notebooks[1].title='Renamed sessions';assert.notEqual(viewScopeLabel(book,bookQuery),oldLabel);
 assert.equal(viewScopeIssue(book,bookQuery),'');book.notebooks.splice(1,1);assert.match(viewScopeIssue(book,bookQuery),/no longer/);
 for(const invalid of [{...q,projectId:'all'},{...q,notebookId:randomUUID(),projectId:randomUUID()},{...q,search:'x'.repeat(513)},{...q,extra:true},{...q,browse:{...q.browse,from:'2026-99-01'}},{...q,browse:{...q.browse,status:'anything'}},{...q,browse:{...q.browse,dateKnowledge:'unknown'}},{...q,filter:'bad'}])assert.equal(Boolean(validViewQuery(invalid)),false);
 const fresh=JSON.parse(before);fresh.entries.push({...fresh.entries[0],id:randomUUID(),title:'Later take'});
 assert.equal(queryRecords(fresh.entries,{browse:q.browse}).length,4);
 assert.equal(validViewQuery({...q,filter:'template:'+randomUUID()}),true); // Missing types remain restrictive.
});

test('saved view edits are explicit, retryable, conflict guarded and independent of record revisions',async t=>{
 const {book,ws,store}=await fixture(t),etag=(await ws.read()).etag,a=view(),b=view('Another view');
 const first=(await store.save(command(book,a))).view;
 assert.deepEqual((await store.save(command(book,a))).view,first);
 const second=(await store.save(command(book,b))).view;
 const renamed={...a,name:'Renamed takes'},next=(await store.save(command(book,renamed,first.revision))).view;
 await assert.rejects(store.save(command(book,{...a,name:'Stale edit'},first.revision)),{code:'RECORD_VIEW_CHANGED'});
 await assert.rejects(store.remove({workspaceId:book.id,id:a.id,expectedRevision:first.revision}),{code:'RECORD_VIEW_CHANGED'});
 await assert.rejects(store.save(command(book,{...b,name:'renamed takes'},second.revision)),{code:'RECORD_VIEW_NAME'});
 await store.save(command(book,{...b,name:'Unrelated update'},second.revision));
 assert.equal((await store.list({workspaceId:book.id})).views.length,2);
 await assert.rejects(store.list({workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const missing=view('Missing scope',{...baseQuery(),projectId:randomUUID()});
 await assert.rejects(store.save(command(book,missing)),{code:'RECORD_VIEW_SCOPE'});
 await store.remove({workspaceId:book.id,id:a.id,expectedRevision:next.revision});
 await store.remove({workspaceId:book.id,id:a.id,expectedRevision:next.revision}); // Lost acknowledgement.
 assert.equal((await ws.read()).etag,etag);
});

test('missing scope is retained without broadening; malformed catalogs are preserved on failed reads and writes',async t=>{
 const {book,ws,store}=await fixture(t),query={...baseQuery(),projectId:book.projects.at(-1).id},original=view('Departed team',query);
 const saved=(await store.save(command(book,original))).view;
 const snapshot=await ws.read();snapshot.book.projects.pop();const removed=snapshot.book.notebooks.pop();snapshot.book.entries=snapshot.book.entries.filter(e=>e.notebookId!==removed.id);
 await ws.save(snapshot.book,snapshot.etag);
 const listed=(await store.list({workspaceId:book.id})).views[0];assert.deepEqual(listed.query,query);
 assert.match(viewScopeIssue((await ws.read()).book,listed.query),/no longer/);
 await store.save(command(book,{...original,name:'Archived scope'},saved.revision));
 const file=store.file(),raw=JSON.stringify({formatVersion:999,workspaceId:book.id,views:[]});await ws.writeFile(file,raw);
 await assert.rejects(store.list({workspaceId:book.id}),{code:'RECORD_VIEW_FORMAT'});
 await assert.rejects(store.save(command(book,view())),{code:'RECORD_VIEW_FORMAT'});
 assert.equal(await ws.readFile(file,'utf8'),raw);
});

test('encrypted saved views survive verified copies and never enter publication output',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-view-copy-')),root=path.join(parent,'source'),book=queryFixture(),access=await createAccess('','synthetic view password'),vault=takeCreatedVault(access);
 let restoredVault;
 try{
  await initializeLocation(root,book,access,vault);const ws=new Workspace(root,vault),store=new RecordViews(ws),value=view('PRIVATE VIEW SENTINEL',{...baseQuery(),search:'PRIVATE SEARCH SENTINEL'});
  const etag=(await ws.read()).etag,saved=(await store.save(command(book,value))).view;
  await assertPrivateCatalogue(root,value.name,value.query.search);
  const destination=path.join(parent,'restored');await copyWorkspace(await copyPlan(root,destination));
  restoredVault=await verifyAccess(await readAccess(destination),'','synthetic view password');
  const restored=new Workspace(destination,restoredVault);
  assert.deepEqual((await new RecordViews(restored).list({workspaceId:book.id})).views,[saved]);
  assert.equal((await ws.read()).etag,etag);assert.equal((await restored.read()).etag,etag);
  const output=buildPublication((await restored.read()).book),text=[...output.files.values()].filter(v=>typeof v==='string').join('\n');
  assert.ok(!text.includes(value.name));assert.ok(!text.includes(value.query.search));assert.ok(![...output.files.keys()].some(k=>k.includes('record-views')));
 }finally{clearVault(vault);if(restoredVault)clearVault(restoredVault);await rm(parent,{recursive:true,force:true});}
});

test('saved-view endpoints use authenticated workspace context, reject conflicts, and stop while locked',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-view-service-')),root=path.join(parent,'source'),book=queryFixture(),password='synthetic service password',access=await createAccess('',password),vault=takeCreatedVault(access);
 await initializeLocation(root,book,access,vault);const app=await testServer({root,port:0,headless:true});t.after(async()=>{await app.close();clearVault(vault);await rm(parent,{recursive:true,force:true});});
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const headers={Origin:app.origin,Cookie:auth.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const post=(route,data,extra={})=>fetch(app.origin+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
 assert.equal((await fetch(app.origin+'/api/research/views/list',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({workspaceId:book.id})})).status,401);
 assert.equal((await post('/api/access/unlock',{password})).status,200);
 assert.equal((await post('/api/storage/open',{path:root,password})).status,200);
 const current=await (await fetch(app.origin+'/api/storage',{headers})).json();
 headers['X-Observanda-Workspace']=current.contextId;
 assert.equal((await post('/api/research/views/list',{workspaceId:book.id},{'X-Observanda-Workspace':randomUUID()})).status,409);
 const value=view(),saved=await (await post('/api/research/views/save',command(book,value))).json();
 assert.equal(saved.view.name,value.name);
 assert.equal((await post('/api/research/views/save',command(book,{...value,name:'Conflict'},'a'.repeat(64)))).status,409);
 assert.equal((await post('/api/access/lock',{})).status,200);
 assert.equal((await post('/api/research/views/list',{workspaceId:book.id})).status,401);
});
