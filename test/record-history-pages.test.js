import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordHistoryIndex} from '../src/record-history-index.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordHistory} from '../src/record-history.js';
import {applyRecordPatch} from '../src/web/record-patch.js';

async function fixture(t,count=45){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-history-pages-')),root=path.join(directory,'workspace');
 const access=await createAccess('','synthetic history paging password'),vault=takeCreatedVault(access),book=upgradeNotebook(sampleNotebook());
 book.entries[0].title='Take 0';book.entries[0].body='Private unabridged source material. '.repeat(500);
 await initializeLocation(root,book,access,vault);
 const ws=new Workspace(root,vault),history=new RecordHistory(ws,{}),service=new ResearchRecords(ws,{}),initial=await ws.read();
 let current=initial.book.entries[0],etag=initial.etag;const versions=[current];
 for(let i=1;i<count;i++){
  const result=await service.save({workspaceId:book.id,baseEtag:etag,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Take '+i}}]},{compact:true});
  current=result.recordPatch.records.find(r=>r.id===current.id);etag=result.etag;versions.push(current);
 }
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {directory,ws,vault,history,service,versions,command:{workspaceId:book.id,recordId:current.id},initial};
}

test('history pages never load record bodies and stay anchored across concurrent saves',async t=>{
 const f=await fixture(t),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded for history');};
 ResearchCatalogue.prototype.record=()=>{throw Error('Record body loaded for history summary');};
 let first,second,third;
 try{
  first=await f.history.list(f.command);
  assert.equal(first.versions.length,20);assert.equal(first.total,45);assert.equal(first.versions[0].title,'Take 44');
  assert.ok(JSON.stringify(first).length<20000);assert.ok(!JSON.stringify(first).includes('Private unabridged'));
  second=await f.history.list({...f.command,cursor:first.nextCursor});
  third=await f.history.list({...f.command,cursor:second.nextCursor});
  assert.equal(third.versions.length,5);assert.equal(third.nextCursor,null);
  assert.deepEqual([...first.versions,...second.versions,...third.versions].map(v=>v.revision),f.versions.toReversed().map(recordRevision));
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 const current=f.versions.at(-1);
 await f.service.save({workspaceId:f.command.workspaceId,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Later take'}}]});
 const next=await f.history.list({...f.command,cursor:first.nextCursor});
 assert.deepEqual(next.versions,second.versions);assert.equal(next.total,45);assert.equal(next.changed,true);
 const back=await f.history.list({...f.command,cursor:first.cursor});
 assert.deepEqual(back.versions.map(v=>v.revision),first.versions.map(v=>v.revision));assert.ok(back.versions.every(v=>!v.current));
 assert.equal((await f.history.list(f.command)).total,46);
 assert.deepEqual((await f.history.read({...f.command,...first.versions[0]})).record,current);
 const bytes=Buffer.from(first.nextCursor,'base64url');bytes[bytes.length-3]^=1;
 await assert.rejects(f.history.list({...f.command,cursor:bytes.toString('base64url')}),{code:'RECORD_HISTORY_CURSOR'});
 await assert.rejects(f.history.list({...f.command,recordId:f.initial.book.entries[1].id,cursor:first.nextCursor}),{code:'RECORD_HISTORY_CURSOR'});
 await assert.rejects(f.history.list({...f.command,workspaceId:randomUUID(),cursor:first.nextCursor}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.history.list({...f.command,limit:51}),{code:'INVALID'});
 await assert.rejects(f.history.list({...f.command,cursor:first.nextCursor,limit:10}),{code:'RECORD_HISTORY_CURSOR'});
});

test('record-only restore returns concurrent changes while leaving unrelated bodies unloaded',async t=>{
 const f=await fixture(t,3),base=await f.ws.read(),target=(await f.history.list(f.command)).versions.at(-1),other=base.book.entries[1],unrelated=base.book.entries[2];
 await f.service.save({workspaceId:base.book.id,changes:[{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'Concurrent field notes'}}]});
 const read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded for record restore');};
 ResearchCatalogue.prototype.record=function(id,revision){loaded.push(id);assert.notEqual(id,unrelated.id);return record.call(this,id,revision);};
 let result;
 try{result=await f.history.restore({...f.command,...target,expectedRevision:recordRevision(base.book.entries[0]),baseEtag:base.etag},{compact:true});}
 finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 assert.equal(result.book,undefined);assert.equal(result.recordPatch.records.length,2);assert.ok(loaded.includes(other.id));
 const patched=applyRecordPatch(base.book,base.etag,recordRevisions(base.book),result),saved=await f.ws.read();
 assert.deepEqual(patched.book,saved.book);assert.equal(saved.book.entries[0].title,'Take 0');assert.equal(saved.book.entries[0].share,false);
 assert.equal(saved.book.entries[1].title,'Concurrent field notes');assert.deepEqual(saved.book.entries[2],unrelated);
 await assert.rejects(f.history.restore({...f.command,...target,expectedRevision:recordRevision(base.book.entries[0]),baseEtag:base.etag},{compact:true}),{code:'RECORD_CHANGED'});
 assert.equal((await f.ws.read()).etag,saved.etag);
});

test('retained-only revisions remain reviewable and copied history pages preserve their identities',async t=>{
 const f=await fixture(t,3),materials=new ResearchMaterials(f.ws),retained={...f.versions[0],title:'Retained method reference'};
 await f.ws.withLock(()=>materials.retainRecord(retained));
 await f.ws.withLock(()=>materials.retainRecord(f.versions[0]));
 const listing=await f.history.list({...f.command,limit:2}),tail=await f.history.list({...f.command,limit:2,cursor:listing.nextCursor});
 assert.equal(listing.total,null);assert.equal(tail.total,4);const version=tail.versions.find(v=>v.source.kind==='retained');
 assert.ok(version);assert.deepEqual((await f.history.read({...f.command,...version})).record,retained);
 const backup=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=new RecordHistory(new Workspace(backup,f.vault),{});
 const after=await restored.list({...f.command,limit:2,cursor:listing.nextCursor});assert.deepEqual(after.versions,tail.versions);
 await f.ws.withLock(()=>materials.retainRecord({...retained,title:'Additional retained reference'}));
 await assert.rejects(f.history.list({...f.command,limit:2,cursor:listing.nextCursor}),{code:'RECORD_HISTORY_CURSOR'});
 assert.equal((await f.history.list(f.command)).total,5);
 // A missing retained object must not silently disappear from the history.
 await f.ws.withLock(()=>f.ws.catalogue(store=>store.db.run('DELETE FROM objects WHERE id=$1','metadata:.observanda/materials/records/'+retained.id+'/'+recordRevision(retained)+'.json')));
 await assert.rejects(f.history.list(f.command),{code:'CATALOGUE_DAMAGED'});
});

test('older history indexes fall back only for a selected page and verification checks cached summaries',async t=>{
 const f=await fixture(t,25),slot='history:'+f.command.recordId;
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const index=store.historyIndex(f.command.recordId),head=await index.head(),versions=[];
  for await(const item of index.items(head)){const {view,...row}=item;versions.push(row);}
  await store.db.run('DELETE FROM state WHERE starts_with(slot,$1)',index.prefix);
  const value={recordId:f.command.recordId,versions};
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,value),slot);
 }));
 const record=ResearchCatalogue.prototype.record,loaded=[];let olderPage;
 ResearchCatalogue.prototype.record=function(id,revision){loaded.push(id);return record.call(this,id,revision);};
 try{const first=await f.history.list({...f.command,limit:5});olderPage=first;assert.equal(first.versions.length,5);assert.ok(loaded.length<=6);assert.ok(loaded.every(id=>id===f.command.recordId));}
 finally{ResearchCatalogue.prototype.record=record;}
 const current=f.versions.at(-1);
 await f.service.save({workspaceId:f.command.workspaceId,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'With cached summary'}}]});
 await assert.rejects(f.history.list({...f.command,limit:5,cursor:olderPage.nextCursor}),{code:'RECORD_HISTORY_CURSOR'});
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const index=store.historyIndex(current.id),head=await index.head();assert.equal(head.formatVersion,2);
  const key=index.prefix+'row:'+(head.count-1),value=await index.get(key);value.view.title='Incorrect cached title';
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',key,value),key);
 }));
 await assert.rejects(f.ws.catalogue(store=>store.verifyRecordHistory(current.id)),{code:'CATALOGUE_DAMAGED'});
});

test('long record histories append bounded summaries without rewriting earlier entries',async t=>{
 const f=await fixture(t,140),prefix='history-index:'+f.command.recordId+':';
 const before=await f.ws.catalogue(store=>store.db.all('SELECT slot,payload FROM state WHERE starts_with(slot,$1)',prefix));
 const current=f.versions.at(-1),encode=ResearchCatalogue.prototype.encode,writes=[];
 ResearchCatalogue.prototype.encode=function(table,id,value){if(id==='history:'+current.id||id.startsWith(prefix))writes.push({id,bytes:Buffer.byteLength(JSON.stringify(value))});return encode.call(this,table,id,value);};
 try{await f.service.save({workspaceId:f.command.workspaceId,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Newest take'}}]},{compact:true});}
 finally{ResearchCatalogue.prototype.encode=encode;}
 assert.equal(writes.length,4);assert.ok(writes.every(w=>w.bytes<1024));
 const after=await f.ws.catalogue(store=>store.db.all('SELECT slot,payload FROM state WHERE starts_with(slot,$1)',prefix)),bytes=new Map(after.map(r=>[r.slot,r.payload]));
 assert.equal(after.length,before.length+3);for(const row of before)assert.deepEqual(bytes.get(row.slot),row.payload);
 const decode=ResearchCatalogue.prototype.decode;let summaries=0;
 ResearchCatalogue.prototype.decode=function(table,id,bytes){if(id.startsWith(prefix+'row:'))summaries++;return decode.call(this,table,id,bytes);};
 try{const first=await f.history.list({...f.command,limit:5});assert.equal(first.total,141);assert.equal(first.versions[0].title,'Newest take');assert.ok(summaries<=7);}
 finally{ResearchCatalogue.prototype.decode=decode;}
 await f.ws.catalogue(async store=>{const head=await store.historyIndex(current.id).head();assert.equal(head.count,141);assert.ok(JSON.stringify(head).length<200);});
});

test('history index failure rolls back its record and missing entries cannot disappear from paging',async t=>{
 const f=await fixture(t,4),base=await f.ws.read(),current=base.book.entries[0],prefix='history-index:'+current.id+':',insert=RecordHistoryIndex.prototype.insert;
 const before=await f.ws.catalogue(store=>store.db.all('SELECT slot,payload FROM state WHERE starts_with(slot,$1) ORDER BY slot',prefix));
 RecordHistoryIndex.prototype.insert=async function(slot,value){if(slot.startsWith(this.prefix+'view:'))throw Error('Interrupted history append');return insert.call(this,slot,value);};
 try{await assert.rejects(f.service.save({workspaceId:f.command.workspaceId,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Not committed'}}]}),/Interrupted history append/);}
 finally{RecordHistoryIndex.prototype.insert=insert;}
 assert.deepEqual(await f.ws.read(),base);assert.deepEqual(await f.ws.catalogue(store=>store.db.all('SELECT slot,payload FROM state WHERE starts_with(slot,$1) ORDER BY slot',prefix)),before);
 for(const slot of [prefix+'row:0',prefix+'view:'+recordRevision(f.versions[0])]){
  const saved=before.find(r=>r.slot===slot);assert.ok(saved);
  await f.ws.withLock(()=>f.ws.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1',slot)));
  await assert.rejects(f.history.list({...f.command,limit:1}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(f.service.save({workspaceId:f.command.workspaceId,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Cannot ignore damaged history'}}]}),{code:'CATALOGUE_DAMAGED'});
  assert.deepEqual(await f.ws.read(),base);
  await f.ws.withLock(()=>f.ws.catalogue(store=>store.db.run('INSERT INTO state VALUES ($1,$2)',saved.slot,saved.payload)));
 }
 assert.equal((await f.history.list(f.command)).total,4);
 const key=prefix+'view:'+recordRevision(f.versions[0]),row=before.find(r=>r.slot===key),damaged=Buffer.from(row.payload);damaged[damaged.length-1]^=1;
 await f.ws.withLock(()=>f.ws.catalogue(store=>store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',damaged,key)));
 await assert.rejects(copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'damaged-copy')),{vault:f.vault}),{code:'ENCRYPTION_DAMAGED'});
 assert.deepEqual(await f.ws.read(),base);
});

test('canonical duplicate revisions stay distinct in storage and appear once with an earlier current revision first',async t=>{
 const f=await fixture(t,3),saved=await f.ws.read(),earlier=f.versions[0];
 saved.book.entries[0]=Object.fromEntries(Object.entries(earlier).reverse());
 await f.ws.withLock(()=>f.ws.catalogue(store=>store.put(saved.book)));
 const first=await f.history.list({...f.command,limit:2}),second=await f.history.list({...f.command,limit:2,cursor:first.nextCursor});
 assert.equal(first.total,3);assert.deepEqual([...first.versions,...second.versions].map(v=>v.title),['Take 0','Take 2','Take 1']);
 assert.equal(first.versions[0].current,true);assert.deepEqual((await f.history.read({...f.command,...first.versions[0]})).record,earlier);
 await f.ws.catalogue(async store=>{const head=await store.historyIndex(earlier.id).head();assert.equal(head.count,3);assert.equal(head.revisions,4);await store.verifyRecordHistory(earlier.id);});
 const backup=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'canonical-copy')),{vault:f.vault});
 const copied=new RecordHistory(new Workspace(backup,f.vault),{});assert.deepEqual((await copied.list({...f.command,limit:2})).versions,first.versions);
 const record=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Removal must use the authenticated canonical revision alias');};
 try{await f.service.remove({...f.command,expectedRevision:recordRevision(earlier)});}finally{ResearchCatalogue.prototype.record=record;}
 const removed=await f.ws.catalogue(store=>store.recordSelection([earlier.id]));
 assert.deepEqual(removed.recordScope.missing,[earlier.id]);assert.equal(removed.recordScope.total,saved.book.entries.length-1);
});
