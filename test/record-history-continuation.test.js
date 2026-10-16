import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordHistory} from '../src/record-history.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
const contents=({cursor,nextCursor,...result})=>({...result,hasCursor:!!cursor,hasNext:!!nextCursor});

test('retained reference history continues without scanning all references or loading unselected bodies',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-history-')),book=sampleNotebook(),{workspace:ws,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 const records=new ResearchRecords(ws,{}),materials=new ResearchMaterials(ws),history=new RecordHistory(ws,{}),command={workspaceId:book.id,recordId:book.entries[0].id,limit:5};
 let current=(await ws.read()).book.entries[0];const versions=[current];
 for(let i=1;i<270;i++){
  const next={...current,title:'Revision '+i};await records.save({workspaceId:book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:next}]},{receipt:true});
  current=(await history.context(command)).record;versions.push(current);
 }
 await ws.withLock(async()=>{for(const record of versions)await materials.retainRecord(record);});
 // A duplicate-only tail must continue through bounded empty windows and then
 // finish with the correct distinct count. No probabilistic hash search needed.
 let duplicateCursor=null,duplicateCount=0,emptyContinues=0,duplicateTail;
 do{
  duplicateTail=await history.list({...command,limit:50,cursor:duplicateCursor});duplicateCount+=duplicateTail.versions.length;
  if(!duplicateTail.versions.length&&duplicateTail.nextCursor)emptyContinues++;
  duplicateCursor=duplicateTail.nextCursor;
 }while(duplicateCursor);
 assert.equal(duplicateCount,270);assert.equal(duplicateTail.total,270);assert.ok(emptyContinues>0);
 const extras=Array.from({length:137},(_,i)=>({...current,title:'Retained reference '+i,body:'Original method details '+i}));
 await ws.withLock(async()=>{for(const record of extras)await materials.retainRecord(record);});
 const entries=ResearchCatalogue.prototype.objectIdEntries,object=ResearchCatalogue.prototype.object,record=ResearchCatalogue.prototype.record;
 let reads=0,summaryReads=0,pages=0;const decode=ResearchCatalogue.prototype.decode;
 ResearchCatalogue.prototype.objectIdEntries=()=>{throw Error('Unbounded retained reference scan');};
 ResearchCatalogue.prototype.record=()=>{throw Error('Unselected original record read');};
 ResearchCatalogue.prototype.object=function(id){if(id.startsWith('metadata:.observanda/materials/records/'))reads++;return object.call(this,id);};
 ResearchCatalogue.prototype.decode=function(table,id,payload){if(id.startsWith('history-index:'+current.id+':row:'))summaryReads++;return decode.call(this,table,id,payload);};
 let first,tail,all=[],cursor=null;
 try{
  do{
   reads=0;summaryReads=0;const result=await history.list({...command,cursor});first??=result;tail=result;pages++;
   assert.ok(reads<=5,'only selected retained bodies are read');assert.ok(summaryReads<=270,'one page examines a bounded group of duplicate references');
   assert.ok(result.versions.length<=5);assert.equal(result.offset,all.length);assert.ok(JSON.stringify(result).length<16000);
   all.push(...result.versions);cursor=result.nextCursor;
  }while(cursor);
 }finally{ResearchCatalogue.prototype.objectIdEntries=entries;ResearchCatalogue.prototype.object=object;ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.decode=decode;}
 assert.ok(pages>80);assert.equal(first.total,null);assert.equal(tail.total,407);assert.equal(all.length,407);
 assert.equal(new Set(all.map(v=>v.revision)).size,407);assert.deepEqual(all.slice(0,270).map(v=>v.revision),versions.toReversed().map(recordRevision));
 assert.deepEqual(new Set(all.slice(270).map(v=>v.revision)),new Set(extras.map(recordRevision)));
 const selected=all.at(-1);assert.deepEqual((await history.read({...command,...selected})).record,extras.find(r=>recordRevision(r)===selected.revision));
 const again=await history.list({...command,cursor:first.cursor});assert.deepEqual(contents(again),contents(first));
 // Ordinary evidence writes must not invalidate this record's history cursor.
 await ws.withLock(()=>ws.writeMetadata('.observanda/unrelated-history-check.json','{}'));
 assert.deepEqual(contents(await history.list({...command,cursor:first.cursor})),contents(first));
 await ws.withLock(()=>ws.removeMetadata('.observanda/unrelated-history-check.json'));
 const backup=await copyWorkspace(await copyPlan(ws.root,path.join(directory,'backup')),{vault}),restored=new RecordHistory(new Workspace(backup,vault),{});
 assert.deepEqual(contents(await restored.list({...command,cursor:first.cursor})),contents(first));
 // An exact retained retry is harmless; a replacement/removal must invalidate
 // continuation even if another insertion leaves the total count unchanged.
 await ws.withLock(()=>materials.retainRecord(extras[0]));assert.deepEqual(contents(await history.list({...command,cursor:first.cursor})),contents(first));
 await ws.withLock(async()=>{await ws.removeMetadata('.observanda/materials/records/'+current.id+'/'+recordRevision(extras[0])+'.json');await materials.retainRecord({...extras[0],title:'New retained reference'});});
 await assert.rejects(history.list({...command,cursor:first.nextCursor}),{code:'RECORD_HISTORY_CURSOR'});
});

test('legacy retained history needs no read-time rewrite and changed-token failures roll back with their reference',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-history-state-')),book=sampleNotebook(),{workspace:ws,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 const materials=new ResearchMaterials(ws),history=new RecordHistory(ws,{}),record=(await ws.read()).book.entries[0],command={workspaceId:book.id,recordId:record.id,limit:1},slot='retained-record-history:'+record.id;
 const retained={...record,title:'Reference from an earlier installation'};await ws.withLock(()=>materials.retainRecord(retained));
 await ws.withLock(()=>ws.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1',slot)));
 const first=await history.list(command);assert.equal(first.total,null);
 assert.equal(await ws.catalogue(async store=>!!await store.db.get('SELECT 1 FROM state WHERE slot=$1',slot)),false);
 const encode=ResearchCatalogue.prototype.encode,candidate={...retained,title:'Failed retained write'};
 ResearchCatalogue.prototype.encode=function(table,key,value){if(key===slot)throw Error('Interrupted retained history checkpoint');return encode.call(this,table,key,value);};
 try{await assert.rejects(ws.withLock(()=>materials.retainRecord(candidate)),/Interrupted retained history checkpoint/);}
 finally{ResearchCatalogue.prototype.encode=encode;}
 assert.deepEqual(contents(await history.list({...command,cursor:first.cursor})),contents(first));
 assert.equal(await ws.catalogue(store=>store.objectIdentity('metadata:.observanda/materials/records/'+record.id+'/'+recordRevision(candidate)+'.json')),null);
 const tail=await history.list({...command,cursor:first.nextCursor});assert.equal(tail.total,2);assert.equal(tail.versions[0].title,retained.title);
 await ws.withLock(()=>materials.retainRecord(candidate));await assert.rejects(history.list({...command,cursor:first.nextCursor}),{code:'RECORD_HISTORY_CURSOR'});
 const access=await createAccess('','new history recovery password'),nextVault=takeCreatedVault(access);t.after(()=>clearVault(nextVault));
 const copied=await encryptedCopy(await copyPlan(ws.root,path.join(directory,'fresh-key')),access,nextVault,vault),restored=new RecordHistory(new Workspace(copied,nextVault),{});
 const before=await history.list({...command,limit:20}),after=await restored.list({...command,limit:20});assert.deepEqual(contents(after),contents(before));
 const row=await ws.catalogue(store=>store.db.get('SELECT payload FROM state WHERE slot=$1',slot)),damaged=Buffer.from(row.payload);damaged[damaged.length-1]^=1;
 await ws.withLock(()=>ws.catalogue(store=>store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',damaged,slot)));
 await assert.rejects(history.list(command),{code:'ENCRYPTION_DAMAGED'});
});
