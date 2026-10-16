import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {largeRecordBook} from './record-capacity-fixture.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {MAX_BYTES} from '../src/model.js';

test('near-limit record checkpoints pin one base and survive concurrency, failed writes and both recovery modes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-capacity-')),book=largeRecordBook(),f=await encryptedFixture(directory,book),base=book.entries[0],drafts=new ResearchDrafts(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const change={record:{...base,title:'Unfinished large record'},expectedRevision:recordRevision(base),baseRevision:recordRevision(base)},command={id:randomUUID(),workspaceId:book.id,expectedRevision:null,changes:[change]};
 const record=ResearchCatalogue.prototype.record,reads=[];t.mock.method(ResearchCatalogue.prototype,'record',function(id,...args){reads.push(id);return record.call(this,id,...args);});
 const start=performance.now(),saved=await drafts.write(command),elapsed=performance.now()-start;
 assert.deepEqual(reads,[]);assert.equal((await drafts.write(command)).revision,saved.revision);assert.deepEqual(reads,[]);
 const raw=await f.workspace.readMetadata('.observanda/drafts/'+command.id+'.json',MAX_BYTES);assert.ok(Buffer.byteLength(raw)>1.9*1024*1024);assert.ok(Buffer.byteLength(raw)<MAX_BYTES);assert.equal(JSON.parse(raw).changes[0].base,undefined);
 assert.equal((await drafts.list()).drafts.length,1);assert.deepEqual(reads,[]);
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:{...base,title:'Concurrent saved title'}}]},{receipt:true});reads.length=0;
 const recovered=await drafts.read(command.id);assert.deepEqual(reads,[base.id]);assert.deepEqual(recovered.draft.changes[0].base,base);assert.equal(recovered.draft.changes[0].record.title,change.record.title);
 const put=ResearchCatalogue.prototype.putObject;t.mock.method(ResearchCatalogue.prototype,'putObject',function(id,...args){if(id.startsWith('metadata:.observanda/draft-list/'))throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});return put.call(this,id,...args);});
 await assert.rejects(drafts.write({...command,expectedRevision:saved.revision,changes:[{...change,record:{...change.record,title:'Failed checkpoint'}}]}),{code:'ENOSPC'});t.mock.restoreAll();assert.equal((await drafts.read(command.id)).revision,saved.revision);
 await assert.rejects(drafts.write({...command,expectedRevision:saved.revision,changes:[{...change,record:{...base,id:randomUUID()}}]}),{code:'RECORD_HISTORY_MISSING'});
 const next=await drafts.write({...command,expectedRevision:saved.revision,changes:[{...change,record:{...change.record,title:'Newer checkpoint'}}]});await assert.rejects(drafts.write(command),{code:'DRAFT_CHANGED'});
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault}),access=await createAccess('','fresh record draft recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault);
 for(const ws of [new Workspace(backup,f.vault),new Workspace(fresh,vault)]){const restored=await new ResearchDrafts(ws).read(command.id);assert.equal(restored.revision,next.revision);assert.deepEqual(restored.draft.changes[0].base,base);assert.equal(restored.draft.changes[0].record.title,'Newer checkpoint');}
 // Missing pinned history never turns a recoverable comparison into a new record.
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1','history-index:'+base.id+':view:'+change.baseRevision)));
 await assert.rejects(drafts.read(command.id),{code:'RECORD_HISTORY_MISSING'});
 assert.ok(elapsed<5000);t.diagnostic(JSON.stringify({checkpointBytes:Buffer.byteLength(raw),writeMs:Math.round(elapsed),writeOriginalReads:0,restoreOriginalReads:1,heapMiB:Math.round(process.memoryUsage().heapUsed/1024/1024)}));
});
