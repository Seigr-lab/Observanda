import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook,MAX_BYTES} from '../src/model.js';
import {MAX_RECORD_BYTES} from '../src/web/research-capacity.js';
import {createFigure} from '../src/web/figure-model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchRecords,recordRevision,historicalBook} from '../src/research.js';
import {RecordHistory} from '../src/record-history.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {Workspace} from '../src/storage.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';

test('a valid dense record saves, indexes, retains, restores and survives a verified copy above the legacy envelope',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-envelope-')),book=upgradeNotebook(sampleNotebook());
 book.entries=book.entries.slice(0,1);book.entries[0].attachments=[];
 const f=await encryptedFixture(path.join(directory,'source'),book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const original=book.entries[0],figure=createFigure();figure.series[0].points=Array.from({length:18000},(_,i)=>({x:i,y:i%37,error:null}));
 const record={...original,figures:[figure]},envelope={...book,entries:[record]};
 assert.ok(Buffer.byteLength(JSON.stringify(record,null,2)+'\n')<MAX_RECORD_BYTES);
 assert.ok(Buffer.byteLength(JSON.stringify(envelope,null,2)+'\n')>MAX_BYTES);
 assert.throws(()=>validateNotebook(envelope),{code:'LIMIT'},'The legacy document transport remains explicitly bounded');
 assert.deepEqual(historicalBook(book,record).entries[0],record);
 assert.throws(()=>historicalBook(book,{...record,title:''}),{code:'INVALID'});
 const service=new ResearchRecords(f.workspace,{}),command={workspaceId:book.id,recordId:record.id};
 const saved=await service.save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(original),record}]},{recordIds:[record.id]});
 record.updatedAt=saved.book.entries[0].updatedAt;assert.deepEqual(saved.book.entries[0],record);
 const materials=new ResearchMaterials(f.workspace),pin=await materials.pinRecord(record.id,recordRevision(record));
 assert.deepEqual(await materials.read(pin),record);
 const history=new RecordHistory(f.workspace,{}),listing=await history.list(command),version=listing.versions.find(v=>v.revision===recordRevision(record));
 assert.deepEqual((await history.read({...command,...version})).record,record);
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.verifySnapshot(undefined,book.id),row=await store.member(snapshot,record.id);
  // Recreate a search/browse derivative and exercise the old-cache fallback.
  const retained=await store.putQuery(record,snapshot.metadata);assert.equal(retained.queryRevision,row.queryRevision);
  const results=[];for await(const value of store.queryDocuments([{...row,queryRevision:null,summaryRevision:null}],snapshot.metadata,{cards:true}))results.push(value);
  assert.equal(results[0].title,record.title);
 });
 const changed=await service.save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Revised interpretation'}}]},{recordIds:[record.id]});
 const restored=await history.restore({...command,...version,expectedRevision:changed.recordRevisions[record.id]},{recordIds:[record.id]});
 assert.deepEqual(restored.book.entries[0].figures,record.figures);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'restored')),{vault:f.vault}),workspace=new Workspace(copy,f.vault);
 const opened=await new WorkspaceReader(workspace).selection({workspaceId:book.id,ids:[record.id]});assert.deepEqual(opened.book.entries,restored.book.entries);
 assert.deepEqual(await new ResearchMaterials(workspace).read(pin),record);
 await workspace.catalogue(store=>store.verifySnapshot(saved.etag,book.id));
 // Ordinary operations above must never require whole-workspace assembly.
 const read=ResearchCatalogue.prototype.read;t.mock.method(ResearchCatalogue.prototype,'read',()=>{throw Error('Whole workspace assembly');});
 assert.deepEqual((await new RecordHistory(workspace,{}).read({...command,...version})).record,record);
 ResearchCatalogue.prototype.read=read;
});
