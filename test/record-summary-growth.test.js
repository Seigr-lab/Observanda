import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RecordQuery} from '../src/record-query.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {recordBrowse,queryRecords} from '../src/web/record-query.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {catalogueFormat} from '../src/catalogue-format.js';
const query=browse=>({projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse(browse)});
async function fixture(t,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-summary-growth-')),book=sampleNotebook(),seed=book.entries[2];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Study '+i,
  body:'Private original prose, absent from metadata browsing. '.repeat(20),sections:[],relations:[],figures:[],attachments:[],contributors:[],tags:[i%2?'field':'studio'],share:false}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,service:new RecordQuery(f.workspace)};
}

test('broad and filter-only pages use separate summaries at 65 and 650 records without decrypting prose',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [65,650]){
  const f=await fixture(t,count),decode=ResearchCatalogue.prototype.decode,read=ResearchCatalogue.prototype.record;
  let bytes=0,documents=0;
  ResearchCatalogue.prototype.record=()=>{throw Error('Body loaded during summary browsing');};
  ResearchCatalogue.prototype.decode=function(table,id,payload){
   assert.ok(!id.startsWith('record-query:'),'Search text loaded without a text search');
   if(id.startsWith('record-summary:')){bytes+=payload.length;documents++;}
   return decode.call(this,table,id,payload);
  };
  let first,elapsed;
  try{
   const start=performance.now();first=await f.service.list({workspaceId:f.book.id,query:query({sort:'title'}),limit:10});elapsed=performance.now()-start;
   assert.equal(first.total,count);assert.deepEqual(first.records.map(r=>r.id),queryRecords(f.book.entries,{browse:recordBrowse({sort:'title'})}).slice(0,10).map(r=>r.id));
   assert.equal(documents,count);assert.ok(bytes<count*1400);assert.ok(elapsed<5000,'Broad first-page budget: '+elapsed);
   const filtered=await f.service.list({workspaceId:f.book.id,query:query({tags:'field',sort:'title'}),limit:10});
   assert.equal(filtered.total,Math.floor(count/2));assert.ok(filtered.records.every(r=>r.tags.includes('field')));
   const selected=f.book.entries[count-1];
   const labels=await new WorkspaceReader(f.workspace).labels({workspaceId:f.book.id,etag:first.snapshotId,ids:[selected.id]});
   assert.equal(labels.records[0].title,selected.title);
   assert.ok(!JSON.stringify(first).includes('Private original prose'));
  }finally{ResearchCatalogue.prototype.decode=decode;ResearchCatalogue.prototype.record=read;}
  const original=f.book.entries[0];
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'Changed after first page'}}]},{recordIds:[original.id]});
  const next=await f.service.list({workspaceId:f.book.id,query:query({sort:'title'}),cursor:first.nextCursor,limit:10});
  assert.equal(next.changed,true);assert.deepEqual(next.records.map(r=>r.id),queryRecords(f.book.entries,{browse:recordBrowse({sort:'title'})}).slice(10,20).map(r=>r.id));
  const searched=await f.service.list({workspaceId:f.book.id,query:{...query(),search:'Private original prose'},limit:10});assert.equal(searched.total,count);
  t.diagnostic(JSON.stringify({records:count,firstPageMs:Math.round(elapsed),metadataBytesPerRecord:Math.round(bytes/documents),bodyReads:0}));
 }
});

test('missing or changed browse summaries fail closed while retained originals remain readable',async t=>{
 const f=await fixture(t,3),source=await f.workspace.catalogue(store=>store.snapshot()),row=await f.workspace.catalogue(store=>store.member(source,f.book.entries[0].id));
 const slot='record-summary:'+row.id+':'+row.summaryRevision;
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,{id:row.id,title:'Wrong summary'}),slot)));
 await assert.rejects(f.service.list({workspaceId:f.book.id,query:query()}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id)),{code:'CATALOGUE_DAMAGED'});
 assert.equal((await new WorkspaceReader(f.workspace).selection({workspaceId:f.book.id,ids:[row.id]})).book.entries[0].body,f.book.entries[0].body);
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1',slot)));
 await assert.rejects(f.service.list({workspaceId:f.book.id,query:query()}),{code:'CATALOGUE_DAMAGED'});
});

test('one record with many section labels uses selected query fields without assembling its header collections',async t=>{
 const f=await fixture(t,1),before=(await f.workspace.read()).book.entries[0];
 const record={...before,sections:Array.from({length:1200},(_,i)=>({id:randomUUID(),title:'Retained section '+i+' '+('label '.repeat(15)),body:'Original evidence remains in this section.'}))};
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  await store.putQuery(record,(await store.snapshot()).metadata);assert.equal(await catalogueFormat(store.db),5);throw Error('Interrupted query upgrade');
 })),/Interrupted query upgrade/);
 assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),3);
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(before),record}]},{receipt:true});
 const select=RecordValueTree.prototype.selected,fields=[];
 t.mock.method(RecordValueTree.prototype,'selected',function(root,path){fields.push(path.join('.'));if(['searchText','cardSources','referenceTargets','publicationDescriptor','editionInventory'].includes(path[0]))throw Error('Unrequested large derivative loaded');return select.call(this,root,path);});
 const first=await f.service.list({workspaceId:f.book.id,query:query(),limit:10});assert.equal(first.records.length,1);assert.equal(first.records[0].title,record.title);
 assert.ok(Buffer.byteLength(JSON.stringify(first))<4096);assert.deepEqual(fields,[]);t.mock.restoreAll();
 await f.workspace.catalogue(async store=>{
  assert.equal(await catalogueFormat(store.db),6);const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id);
  const [document]=await Array.fromAsync(store.queryDocuments([row],snapshot.metadata,{search:false,cardSources:true}));
  assert.equal(document.cardSources.sections.length,1200);assert.equal(document.cardSources.sections.at(-1).title,record.sections.at(-1).title);
  await store.verifySnapshot(undefined,f.book.id);
 });
});
