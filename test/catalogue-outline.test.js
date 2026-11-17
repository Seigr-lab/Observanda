import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {legacyCatalogueFixture} from './legacy-catalogue-fixture.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {workspaceReader} from '../src/web/workspace-reader.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {RecordReadingIndex} from '../src/record-reading-index.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
async function fixture(t,options){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-legacy-outline-')),f=await legacyCatalogueFixture(directory,options);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,reader:new WorkspaceReader(f.workspace)};
}
test('flat catalogues beyond legacy count and byte budgets open an outline and select only requested originals',async t=>{
 for(const count of [60,1200]){
  const f=await fixture(t,{count}),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,loaded=[];
  ResearchCatalogue.prototype.read=()=>{throw Error('Complete workspace requested');};
  ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return record.call(this,id,...args);};
  try{
   const client=workspaceReader((route,data,options)=>route.endsWith('/start')?f.reader.start(options):f.reader.page(data,options)),outline=await client.read({metadataOnly:true});
   assert.equal(outline.outline,true);assert.equal(outline.total,count);assert.deepEqual(Object.values(outline.notebookCounts),[count/2,count/2]);assert.deepEqual(loaded,[]);
   if(count>1000)await assert.rejects(client.read(),{code:'WORKSPACE_READ_LIMIT'});
   const missing=randomUUID(),ids=[f.records.at(-1).id,f.records[0].id,missing],result=await f.reader.selection({workspaceId:f.book.id,ids});
   assert.deepEqual(result.book.entries.map(r=>r.id),ids.slice(0,2));assert.deepEqual(result.recordScope.missing,[missing]);assert.deepEqual(loaded,ids.slice(0,2));
   assert.equal(result.recordScope.total,count);assert.equal(result.book.entries[0].body,f.records.at(-1).body);
   assert.equal((await f.workspace.outline()).etag,f.etag);
  }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 }
});
test('flat pages remain pinned, resume after interruption and preserve order across later writes and backup',async t=>{
 const f=await fixture(t,{count:46}),start=await f.reader.start(),command={workspaceId:f.book.id,cursor:start.cursor};
 const first=await f.reader.page(command);assert.equal(first.records.length,20);assert.deepEqual(first.records.map(r=>r.record.id),f.records.slice(0,20).map(r=>r.id));
 const selected=await f.reader.selection({workspaceId:f.book.id,ids:[f.records[0].id]}),original=selected.book.entries[0];
 await f.service.save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'Edited after first page'}}]},{recordIds:[original.id]});
 let interrupt=true,failed,requests=[];
 const client=workspaceReader(async(route,data,options)=>{
  if(route.endsWith('/start'))return start;
  requests.push(data.cursor);
  if(interrupt&&requests.length===2){interrupt=false;failed=data.cursor;throw Error('Interrupted page');}
  return f.reader.page(data,options);
 });
 await assert.rejects(client.read(),/Interrupted page/);const complete=await client.read();assert.equal(requests[2],failed);
 assert.deepEqual(complete.book.entries.map(r=>r.id),f.records.map(r=>r.id));assert.equal(complete.book.entries[0].title,original.title);
 assert.equal((await f.reader.selection({workspaceId:f.book.id,ids:[original.id]})).book.entries[0].title,'Edited after first page');
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy'),{vault:f.vault}),{vault:f.vault}),reader=new WorkspaceReader(new Workspace(copy,f.vault));
 const restored=await reader.page(command);assert.deepEqual({...restored,nextCursor:null},{...first,nextCursor:null});
 assert.equal((await reader.start({workspaceId:f.book.id,snapshotId:f.etag})).total,46);
});
test('declared ownership with a missing authenticated index entry is rejected, never repaired by a fallback',async t=>{
 const f=await fixture(t,{kind:'indexed'});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const source=await store.snapshot(),index=new SnapshotIndex(store),row=await store.member(source,f.records[0].id);
  source.membership=await index.change(source.membership,'book:'+row.notebookId+':'+row.id,null);await index.flush(source.membership);
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.etag,source),f.etag);
 }));
 await assert.rejects(f.reader.start(),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.reader.selection({workspaceId:f.book.id,ids:[f.records[0].id]}),{code:'CATALOGUE_DAMAGED'});
});
