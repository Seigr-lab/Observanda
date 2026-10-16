import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordRecentIndex} from '../src/record-recent-index.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {DashboardRecords} from '../src/dashboard-records.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {recentRecordOrder} from '../src/web/query-order.js';

async function fixture(t,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-recent-index-')),book=sampleNotebook(),seed=book.entries[0];
 book.notebooks=Array.from({length:3},(_,i)=>({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Book '+i}));
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Trial '+i,body:'Unabridged original '.repeat(40),sections:[],figures:[],attachments:[],relations:[],contributors:[],tags:[],notebookId:book.notebooks[i%book.notebooks.length].id,
  updatedAt:new Date(Date.UTC(2026,0,1,0,Math.floor(i/3))).toISOString()}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const etag=await f.workspace.catalogue(store=>store.head());
 return {...f,book,query:new DashboardRecords(f.workspace),command:{workspaceId:book.id,etag,config:defaultPanelConfig(),options:{},limit:7,key:null,provider:'records'}};
}

test('recent cards merge only one candidate per lab book and a requested page at 65 and 650 records',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [65,650]){
  const f=await fixture(t,count),ordered=[...f.book.entries].sort(recentRecordOrder),members=ResearchCatalogue.prototype.members,decode=ResearchCatalogue.prototype.decode,record=ResearchCatalogue.prototype.record;
  let summaries=0,bodies=0;
  ResearchCatalogue.prototype.members=()=>{throw Error('Recent card scanned the corpus');};
  ResearchCatalogue.prototype.decode=function(table,id,...args){if(id.startsWith('record-member:'))summaries++;return decode.call(this,table,id,...args);};
  ResearchCatalogue.prototype.record=function(...args){bodies++;return record.apply(this,args);};
  try{
   const start=performance.now(),first=await f.query.read(f.command),ms=performance.now()-start;
   assert.equal(first.total,count);assert.deepEqual(first.records,ordered.slice(0,7));assert.equal(bodies,7);assert.ok(summaries<=7+f.book.notebooks.length+1);assert.ok(ms<1000);
   t.diagnostic(JSON.stringify({records:count,firstPageMs:Math.round(ms),summaries,bodies,responseBytes:Buffer.byteLength(JSON.stringify(first))}));
   const second=await f.query.read({...f.command,cursor:first.nextCursor});assert.deepEqual(second.records,ordered.slice(7,14));
   assert.deepEqual((await f.query.read({...f.command,cursor:second.previousCursor})).records,first.records);
   const records=[...first.records,...second.records];let page=second;
   while(page.nextCursor){page=await f.query.read({...f.command,cursor:page.nextCursor});records.push(...page.records);}
   assert.deepEqual(records,ordered);assert.equal(new Set(records.map(r=>r.id)).size,count);
   const notebook=f.book.notebooks[0],scoped=await f.query.read({...f.command,options:{notebookMode:'selected',notebookIds:[notebook.id]}});
   assert.deepEqual(scoped.records,ordered.filter(r=>r.notebookId===notebook.id).slice(0,7));assert.equal(scoped.total,ordered.filter(r=>r.notebookId===notebook.id).length);
   const empty=await f.query.read({...f.command,options:{scopeMode:'selected',projectIds:[],includeWorkspace:false}});assert.equal(empty.total,0);assert.deepEqual(empty.records,[]);
  }finally{ResearchCatalogue.prototype.members=members;ResearchCatalogue.prototype.decode=decode;ResearchCatalogue.prototype.record=record;}
 }
});

test('recent ordering follows edits, moves and removals while earlier pages keep their pinned order',async t=>{
 const f=await fixture(t,15),records=new ResearchRecords(f.workspace,{}),first=await f.query.read(f.command),original=f.book.entries[0];
 const changed={...original,title:'Amended',notebookId:f.book.notebooks[1].id};
 const result=await records.save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:changed}]},{recordIds:[original.id]});
 const current=result.book.entries[0],next={...f.command,etag:result.etag};assert.equal((await f.query.read(next)).records[0].id,original.id);
 assert.deepEqual((await f.query.read(f.command)).records,first.records);
 await records.remove({workspaceId:f.book.id,recordId:current.id,expectedRevision:recordRevision(current)});
 const etag=await f.workspace.catalogue(store=>store.head()),after=await f.query.read({...f.command,etag});assert.equal(after.total,14);assert.ok(after.records.every(r=>r.id!==current.id));
 await f.workspace.catalogue(async store=>new RecordRecentIndex(store).verify(await store.snapshot()));
});

test('pre-index snapshots stay readable and a later save builds the ordering without rewriting history',async t=>{
 const f=await fixture(t,12);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const source=await store.snapshot();delete source.recentIndex;await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.command.etag,source),f.command.etag);}));
 const old=await f.query.read(f.command),original=f.book.entries[0];
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'New index'}}]},{recordIds:[original.id]});
 assert.deepEqual((await f.query.read(f.command)).records,old.records);
 await f.workspace.catalogue(async store=>{assert.equal((await store.snapshot(f.command.etag)).recentIndex,undefined);await new RecordRecentIndex(store).verify(await store.snapshot());});
});

test('missing recent ordering entries fail verification rather than silently dropping records',async t=>{
 const f=await fixture(t,8);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new RecordRecentIndex(store),row=await store.member(snapshot,f.book.entries[0].id);
  const root=await index.change(snapshot.recentIndex.root,await index.key(row),null);await index.flush(root);
  await assert.rejects(index.verify({...snapshot,recentIndex:{version:1,root}}),{code:'CATALOGUE_DAMAGED'});
 }));
});
