import {ResearchDrafts} from '../src/research-drafts.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {WorkspaceReader,WORKSPACE_PAGE_BYTES} from '../src/workspace-reader.js';
import {workspaceReader} from '../src/web/workspace-reader.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {WorkspaceEdits} from '../src/workspace-edits.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {WebsiteSites} from '../src/website-sites.js';
import {readWebsiteDocumentRegistry} from '../src/website-document-registry.js';

test('record entry requires an outline and never falls back to complete record pages',async()=>{
 const book=sampleNotebook(),etag='a'.repeat(64),start={metadata:{...book,entries:[]},etag,total:book.entries.length,totalBytes:1,cursor:'next-records',notebookCounts:Object.fromEntries(book.notebooks.map(n=>[n.id,book.entries.filter(r=>r.notebookId===n.id).length]))};
 for(const first of [{book,etag},Object.fromEntries(Object.entries(start).filter(([key])=>key!=='notebookCounts'))]){
  const calls=[],reader=workspaceReader(async route=>{calls.push(route);if(route.endsWith('/start'))return first;throw Error('Record pages must not be requested');});
  await assert.rejects(reader.read({requireOutline:true}),{code:'WORKSPACE_READ_INVALID'});assert.deepEqual(calls,['/api/workspace/read/start']);
 }
 const calls=[],reader=workspaceReader(async route=>{calls.push(route);return start;});const result=await reader.read({requireOutline:true});assert.equal(result.outline,true);assert.deepEqual(result.book.entries,[]);assert.deepEqual(calls,['/api/workspace/read/start']);
});

async function fixture(t,count=45,{large=false,formatVersion=21}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-workspace-pages-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Take '+i,share:false,
  body:'Original '+i,sections:large?Array.from({length:i===0?6:3},()=>({id:randomUUID(),title:'Notes',body:'x'.repeat(59000)})):[],figures:[],attachments:[],relations:[]}));
 book.formatVersion=formatVersion;
 const f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,base:await f.workspace.read(),reader:new WorkspaceReader(f.workspace)};
}
const requestFor=reader=>(route,data,options)=>route.endsWith('/start')?reader.start(options):reader.page(data,options);

test('workspace version detects independent writes without loading record bodies or membership',async t=>{
 const f=await fixture(t,45),workspaceId=f.base.book.id;
 const {read,record}=ResearchCatalogue.prototype,members=SnapshotIndex.prototype.members;
 ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.record=()=>{throw Error('Version read loaded record bodies');};
 SnapshotIndex.prototype.members=()=>{throw Error('Version read scanned membership');};
 try{
  assert.deepEqual(await f.reader.version({workspaceId}),{workspaceId,etag:f.base.etag});
  for(const command of [null,{}, {workspaceId:'invalid'},{workspaceId,extra:true}])await assert.rejects(f.reader.version(command),{code:'INVALID'});
  await assert.rejects(f.reader.version({workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
  await assert.rejects(f.reader.version({workspaceId},{signal:AbortSignal.abort()}),{name:'AbortError'});
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;SnapshotIndex.prototype.members=members;}
 const writer=new Workspace(f.workspace.root,f.vault),snapshot=await writer.read();
 const updated=await writer.save({...snapshot.book,title:'Changed by another writer'},snapshot.etag);
 assert.deepEqual(await f.reader.version({workspaceId}),{workspaceId,etag:updated.etag});
});

test('record labels are bounded, pinned and omit bodies, queries and unrelated metadata',async t=>{
 const f=await fixture(t,320),book=f.base.book,ids=[book.entries[0].id,book.entries.at(-1).id,randomUUID()],command={workspaceId:book.id,etag:f.base.etag,ids};
 const originalRecord=ResearchCatalogue.prototype.record,originalRead=ResearchCatalogue.prototype.read,originalMembers=SnapshotIndex.prototype.members;
 let labels;
 ResearchCatalogue.prototype.record=ResearchCatalogue.prototype.read=()=>{throw Error('Record body loaded for label');};
 SnapshotIndex.prototype.members=()=>{throw Error('Whole membership scanned for labels');};
 try{
  labels=await f.reader.labels(command);
  assert.deepEqual(labels,{workspaceId:book.id,etag:f.base.etag,records:[book.entries[0],book.entries.at(-1)].map(({id,title,notebookId})=>({id,title,notebookId})),missing:[ids[2]]});
  for(const ids of [[],[command.ids[0],command.ids[0]],Array.from({length:21},()=>randomUUID()),['bad']])await assert.rejects(f.reader.labels({...command,ids}),{code:'INVALID'});
  await assert.rejects(f.reader.labels({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
  await assert.rejects(f.reader.labels({...command,extra:true}),{code:'INVALID'});
  const controller=new AbortController();controller.abort();await assert.rejects(f.reader.labels(command,{signal:controller.signal}),{name:'AbortError'});
 }finally{ResearchCatalogue.prototype.record=originalRecord;ResearchCatalogue.prototype.read=originalRead;SnapshotIndex.prototype.members=originalMembers;}
 const draft=structuredClone(book);draft.entries[0].title='A later title';draft.entries.pop();
 await new WorkspaceEdits(f.workspace,{}).save({...workspaceSaveRequest(book,draft,recordRevisions(book)),baseEtag:f.base.etag});
 assert.deepEqual(await f.reader.labels(command),labels);
 const latest=await f.reader.labels({...command,etag:(await f.workspace.outline()).etag});assert.equal(latest.records[0].title,'A later title');assert.deepEqual(latest.missing,ids.slice(1));
});

test('indexed startup reads only one page at growing corpus sizes and reconstructs exact saved order',async t=>{
 for(const count of [32,320]){
  const f=await fixture(t,count),old={read:ResearchCatalogue.prototype.read,manifest:ResearchCatalogue.prototype.manifest,record:ResearchCatalogue.prototype.record},members=SnapshotIndex.prototype.members;
  let bodies=0,rows=0,requests=0;
  ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.manifest=()=>{throw Error('Whole workspace load');};
  ResearchCatalogue.prototype.record=function(...args){bodies++;return old.record.apply(this,args);};
  SnapshotIndex.prototype.members=async function*(...args){for await(const row of members.apply(this,args)){rows++;yield row;}};
  try{
   const client=workspaceReader(async(route,data,options)=>{
    bodies=0;rows=0;const result=await requestFor(f.reader)(route,data,options);
    assert.ok(bodies<=20);assert.ok(rows<=21);
    if(route.endsWith('/start')){assert.equal(bodies,0);assert.equal(rows,0);assert.equal(result.book,undefined);}
    requests++;return result;
   });
   const drafts=new ResearchDrafts(f.workspace),record=f.base.book.entries[0],draftId=randomUUID();
   assert.deepEqual((await drafts.list()).drafts,[]);
   const checkpoint=await drafts.write({id:draftId,workspaceId:f.base.book.id,expectedRevision:null,changes:[{base:record,record:{...record,title:'Unfinished take'},expectedRevision:recordRevision(record)}]});
   assert.equal((await drafts.list()).drafts.length,1);
   await drafts.remove({id:draftId,workspaceId:f.base.book.id,expectedRevision:checkpoint.revision});
   const result=await client.read();
   assert.deepEqual(result,{...f.base,recordRevisions:recordRevisions(f.base.book)});
   assert.equal(requests,1+Math.ceil(count/20));
  }finally{Object.assign(ResearchCatalogue.prototype,old);SnapshotIndex.prototype.members=members;}
  t.diagnostic(count+' records: at most 20 bodies and 21 membership rows per request, zero bodies in startup metadata.');
 }
});

test('pages stay pinned through concurrent edits, removals and appended records',async t=>{
 const f=await fixture(t),start=await f.reader.start(),first=await f.reader.page({workspaceId:start.metadata.id,cursor:start.cursor});
 const draft=structuredClone(f.base.book),removed=draft.entries.splice(1,1)[0];
 draft.entries[0].title='Changed later';draft.entries.push({...structuredClone(draft.entries[0]),id:randomUUID(),title:'New later take'});
 await new WorkspaceEdits(f.workspace,{}).save({...workspaceSaveRequest(f.base.book,draft,recordRevisions(f.base.book)),baseEtag:f.base.etag});
 const client=workspaceReader(async(route,data,options)=>route.endsWith('/start')?start:requestFor(f.reader)(route,data,options));
 assert.deepEqual(await client.read(),{...f.base,recordRevisions:recordRevisions(f.base.book)});
 const again=await f.reader.page({workspaceId:start.metadata.id,cursor:start.cursor});
 assert.deepEqual({...again,nextCursor:null},{...first,nextCursor:null});
 await f.workspace.catalogue(store=>assert.deepEqual(store.decode('workspace-page',start.metadata.id,Buffer.from(again.nextCursor,'base64url')),store.decode('workspace-page',start.metadata.id,Buffer.from(first.nextCursor,'base64url'))));
 assert.ok((await f.workspace.read()).book.entries.every(r=>r.id!==removed.id));
 const latest=await workspaceReader(requestFor(f.reader)).read();assert.deepEqual(latest.book,(await f.workspace.read()).book);
});

test('byte-budget pages preserve oversized originals intact and empty workspaces finish explicitly',async t=>{
 const f=await fixture(t,4,{large:true}),start=await f.reader.start();let cursor=start.cursor,seen=0,bytes=0;
 do{
  const page=await f.reader.page({workspaceId:start.metadata.id,cursor});
  const size=page.bytesLoaded-bytes;assert.ok(size<=WORKSPACE_PAGE_BYTES||page.records.length===1);
  assert.equal(page.records.length,1);seen+=page.records.length;bytes=page.bytesLoaded;cursor=page.nextCursor;
 }while(cursor);
 assert.equal(seen,4);assert.equal(bytes,start.totalBytes);
 assert.deepEqual((await workspaceReader(requestFor(f.reader)).read()).book,f.base.book);
 const empty=await fixture(t,0),result=await workspaceReader(requestFor(empty.reader)).read();
 assert.deepEqual(result.book,empty.base.book);assert.deepEqual(result.recordRevisions,{});
});

test('interrupted reads resume the same cursor without rereading completed pages or adopting partial data',async t=>{
 const f=await fixture(t),requests=[];let interrupt=true,failedCursor;
 const client=workspaceReader(async(route,data,options)=>{
  requests.push({route,data});
  if(route.endsWith('/page')&&requests.filter(r=>r.route.endsWith('/page')).length===2&&interrupt){
   failedCursor=data.cursor;interrupt=false;throw Error('Synthetic connection loss');
  }
  return requestFor(f.reader)(route,data,options);
 });
 await assert.rejects(client.read(),/connection loss/);
 const result=await client.read();
 assert.equal(requests.filter(r=>r.route.endsWith('/start')).length,1);
 assert.equal(requests[3].data.cursor,failedCursor);
 assert.deepEqual(result.book,f.base.book);
 const controller=new AbortController(),paused=workspaceReader(requestFor(f.reader));
 await assert.rejects(paused.read({signal:controller.signal,onProgress:p=>{if(p.loaded===20)controller.abort();}}),{name:'AbortError'});
 assert.deepEqual((await paused.read()).book,f.base.book);
 assert.equal((await f.workspace.read()).etag,f.base.etag);
});

test('cursors reject tampering, a different workspace or key, and cancellation releases the read',async t=>{
 const f=await fixture(t),other=await fixture(t,1),start=await f.reader.start(),command={workspaceId:start.metadata.id,cursor:start.cursor};
 const bytes=Buffer.from(start.cursor,'base64url');bytes[20]^=1;
 await assert.rejects(f.reader.page({...command,cursor:bytes.toString('base64url')}),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(f.reader.page({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(other.reader.page(command),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(f.reader.page({...command,cursor:'x'.repeat(4097)}),{code:'INVALID'});
 for(const value of [null,{},[],{...command,unexpected:true}])await assert.rejects(f.reader.page(value),{code:'INVALID'});
 const controller=new AbortController(),original=ResearchCatalogue.prototype.record;let loaded=0;
 ResearchCatalogue.prototype.record=async function(...args){const value=await original.apply(this,args);loaded++;controller.abort();return value;};
 try{await assert.rejects(f.reader.page(command,{signal:controller.signal}),{name:'AbortError'});assert.equal(loaded,1);}
 finally{ResearchCatalogue.prototype.record=original;}
 const record=f.base.book.entries[0];
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.base.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Still writable'}}]});
 assert.equal((await f.reader.page(command)).records.length,20);
});

test('missing originals and inconsistent authenticated membership totals fail closed',async t=>{
 const f=await fixture(t,1),start=await f.reader.start();
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM records WHERE id=$1',f.base.book.entries[0].id)));
 await assert.rejects(f.reader.page({workspaceId:start.metadata.id,cursor:start.cursor}),{code:'CATALOGUE_DAMAGED'});
 const other=await fixture(t,1),anchor=await other.reader.start();
 await other.workspace.withLock(()=>other.workspace.catalogue(async store=>{
  const value=await store.snapshot(anchor.etag);value.count++;
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',anchor.etag,value),anchor.etag);
 }));
 await assert.rejects(other.reader.page({workspaceId:anchor.metadata.id,cursor:anchor.cursor}),{code:'CATALOGUE_DAMAGED'});
});

test('client rejects duplicated, partial or mismatched pages before exposing a workspace',async t=>{
 const f=await fixture(t),start=await f.reader.start();
 const mutations=[
  p=>{p.etag='f'.repeat(64);},
  p=>{p.records[0]=null;},
  p=>{p.records[1]=p.records[0];},
  p=>{p.records[1].position=p.records[0].position;},
  p=>{p.offset++;},
  p=>{p.nextCursor=null;},
  p=>{p.bytesLoaded=start.totalBytes+1;}
 ];
 for(const mutate of mutations){
  let starts=0,bad=true;
  const reader=workspaceReader(async(route,data,options)=>{
   if(route.endsWith('/start')){starts++;return start;}
   const page=await f.reader.page(data,options);if(bad){mutate(page);bad=false;}return page;
  });
  await assert.rejects(reader.read(),{code:'WORKSPACE_READ_INVALID'});
  assert.deepEqual((await reader.read()).book,f.base.book);assert.equal(starts,2);
 }
});

test('older encrypted catalogues and document workspaces keep the validated compatibility path',async t=>{
 const f=await fixture(t,2,{formatVersion:20}),old=await workspaceReader(requestFor(f.reader)).read();
 assert.deepEqual(old.book,upgradeNotebook(f.base.book));assert.deepEqual(old.recordRevisions,recordRevisions(old.book));
 assert.equal(await f.workspace.catalogue(readWebsiteDocumentRegistry),null);
 await assert.rejects(new WebsiteSites(f.workspace).initialize(),{code:'STORAGE_UPGRADE_REQUIRED'});
 assert.equal(await f.workspace.catalogue(readWebsiteDocumentRegistry),null);
 assert.deepEqual(await f.workspace.read(),f.base);
 await assert.rejects(f.reader.start({snapshotId:f.base.etag,workspaceId:f.base.book.id}),{code:'INVALID'});
 const root=path.join(f.directory,'document'),ws=new Workspace(root);await ws.create(sampleNotebook());
 const result=await workspaceReader(requestFor(new WorkspaceReader(ws))).read();
 assert.deepEqual(result.book,upgradeNotebook((await ws.read()).book));
 await assert.rejects(new WorkspaceReader(ws).start({snapshotId:f.base.etag,workspaceId:f.base.book.id}),{code:'INVALID'});
 assert.deepEqual(await new WorkspaceReader(null).start(),{book:null});
});

test('refresh reads only changed originals and reuses unchanged snapshots at growing corpus sizes',async t=>{
 for(const count of [32,320]){
  const f=await fixture(t,count),base=f.base,record=base.book.entries[0],removed=base.book.entries[1];
  const draft=structuredClone(base.book);draft.title='Updated workspace';draft.entries[0].title='Changed remote take';draft.entries.splice(1,1);
  await new WorkspaceEdits(f.workspace,{}).save({...workspaceSaveRequest(base.book,draft,recordRevisions(base.book)),baseEtag:base.etag});
  const old={read:ResearchCatalogue.prototype.read,manifest:ResearchCatalogue.prototype.manifest,record:ResearchCatalogue.prototype.record};
  const loaded=[];ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.manifest=()=>{throw Error('Whole workspace loaded for refresh');};
  ResearchCatalogue.prototype.record=function(id,...rest){loaded.push(id);assert.equal(id,record.id);return old.record.call(this,id,...rest);};
  let refreshed;
  try{
   refreshed=await f.reader.changes({workspaceId:base.book.id,baseEtag:base.etag});
   assert.equal(refreshed.book,undefined);assert.equal(refreshed.recordPatch.order,null);
   assert.deepEqual(refreshed.recordPatch.removed,[removed.id]);assert.equal(refreshed.recordPatch.records.length,1);
   assert.equal(refreshed.recordPatch.metadata.title,'Updated workspace');assert.deepEqual(loaded,[record.id]);
   const unchanged=await f.reader.changes({workspaceId:base.book.id,baseEtag:refreshed.etag});
   assert.deepEqual(unchanged.recordPatch.records,[]);assert.deepEqual(unchanged.recordPatch.removed,[]);assert.equal(loaded.length,1);
  }finally{Object.assign(ResearchCatalogue.prototype,old);}
  const {applyRecordPatch}=await import('../src/web/record-patch.js');
  const patched=applyRecordPatch(base.book,base.etag,recordRevisions(base.book),refreshed);
  assert.deepEqual(patched.book,(await f.workspace.read()).book);
  t.diagnostic(count+' records: refresh reads one changed original; unchanged refresh reads none.');
 }
});

test('refresh preserves appended identities, validates workspace/base and retains the older-format fallback',async t=>{
 const f=await fixture(t,3),command={workspaceId:f.base.book.id,baseEtag:f.base.etag};
 const before=await f.workspace.read(),next={...structuredClone(before.book.entries[0]),id:randomUUID(),title:'Appended remote take'};
 await new ResearchRecords(f.workspace,{}).save({workspaceId:before.book.id,changes:[{id:next.id,expectedRevision:null,record:next}]});
 const refreshed=await f.reader.changes(command),{applyRecordPatch}=await import('../src/web/record-patch.js');
 assert.deepEqual(applyRecordPatch(before.book,before.etag,recordRevisions(before.book),refreshed).book,(await f.workspace.read()).book);
 for(const value of [null,[],{}, {...command,extra:true},{...command,baseEtag:'bad'}])await assert.rejects(f.reader.changes(value),{code:'INVALID'});
 await assert.rejects(f.reader.changes({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const controller=new AbortController();controller.abort();
 await assert.rejects(f.reader.changes(command,{signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(new WorkspaceReader(null).changes(command),{code:'MISSING'});
 const older=await fixture(t,2,{formatVersion:20});
 const fallback=await older.reader.changes({workspaceId:older.base.book.id,baseEtag:older.base.etag});
 assert.deepEqual(fallback.book,upgradeNotebook(older.base.book));assert.deepEqual(fallback.recordRevisions,recordRevisions(fallback.book));
});

test('refresh cancellation during a body read publishes no response and leaves the saved revision intact',async t=>{
 const f=await fixture(t,2),record=f.base.book.entries[0];
 const saved=await new ResearchRecords(f.workspace,{}).save({workspaceId:f.base.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'New saved title'}}]});
 const original=ResearchCatalogue.prototype.record,controller=new AbortController();
 ResearchCatalogue.prototype.record=async function(...args){const value=await original.apply(this,args);controller.abort();return value;};
 try{await assert.rejects(f.reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag},{signal:controller.signal}),{name:'AbortError'});}
 finally{ResearchCatalogue.prototype.record=original;}
 assert.equal((await f.workspace.read()).etag,saved.etag);
 assert.equal((await f.reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag})).recordPatch.records[0].title,'New saved title');
});
