import {moduleDraftOwners} from './module-domain-fixture.js';
import {ProjectDraftCatalogue} from '../src/project-draft-catalogue.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ModuleDrafts} from '../src/modules/drafts.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {openCatalogue} from '../src/postgres.js';
const source='metadata:.observanda/module-drafts/',summary='metadata:.observanda/module-draft-list/',moduleId='scientific-calculator';
async function fixture(t,count=14){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-draft-pages-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const {drafts,run:draftContext}=moduleDraftOwners(f.workspace,book.id,moduleId),commands=[];
 for(let i=0;i<count;i++){
  const command={id:randomUUID(),workspaceId:book.id,moduleId,etag:null,drafts:[{id:randomUUID(),type:'calculation',expectedRevision:null,base:null,data:{name:'Recovery '+i,expression:'PRIVATE_CHECKPOINT '.repeat(6000)}}]};
  const result=await drafts.write(command);commands.push({...command,etag:result.etag});
 }
 return {...f,directory,book,drafts,commands,draftContext};
}

test('a lost checkpoint reply can be retried without overwriting a different concurrent draft',async t=>{
 const f=await fixture(t,1),saved=f.commands[0];
 const replay=await f.drafts.write({...saved,etag:null});assert.equal(replay.etag,saved.etag);
 const changed={...saved,drafts:saved.drafts.map(d=>({...d,data:{...d.data,name:'Later edit'}}))};
 const result=await f.drafts.write(changed);assert.notEqual(result.etag,saved.etag);
 await assert.rejects(f.drafts.write(saved),{code:'DRAFT_CHANGED'});
 assert.equal((await f.drafts.read(saved.id)).draft.drafts[0].data.name,'Later edit');
});

test('module recovery discovers ten summaries per page without reading checkpoint or research bodies at tenfold growth',async t=>{
 for(const count of [14,140]){
  const f=await fixture(t,count),other={...f.commands[0],id:randomUUID(),etag:null,moduleId:'spreadsheet',drafts:[{...f.commands[0].drafts[0],type:'sheet'}]},otherDrafts=moduleDraftOwners(f.workspace,f.book.id,'spreadsheet').drafts;await otherDrafts.write(other);
  const original=ProjectDraftCatalogue.prototype.objectValue,read=ResearchCatalogue.prototype.read;let bodies=0,summaries=0;
  ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace read');};
  ProjectDraftCatalogue.prototype.objectValue=function(id,...args){if(id.startsWith(source))bodies++;if(id.startsWith(summary))summaries++;return original.call(this,id,...args);};
  try{
   const options={workspaceId:f.book.id,excludeId:f.commands.at(-1).id},start=performance.now(),first=await f.drafts.list(moduleId,options),elapsed=performance.now()-start;
   assert.equal(first.drafts.length,10);assert.equal(first.previousCursor,null);assert.ok(first.nextCursor);assert.equal(summaries,10);assert.equal(bodies,0);
   assert.ok(elapsed<5000);assert.ok(JSON.stringify(first).length<12000);assert.ok(!JSON.stringify(first).includes('PRIVATE_CHECKPOINT'));
   const second=await f.drafts.list(moduleId,{...options,cursor:first.nextCursor}),back=await f.drafts.list(moduleId,{...options,cursor:second.previousCursor});assert.deepEqual(back.drafts,first.drafts);
   const seen=first.drafts.map(d=>d.id);let page=second;
   for(;;){seen.push(...page.drafts.map(d=>d.id));assert.ok(page.drafts.length<=10);if(!page.nextCursor)break;page=await f.drafts.list(moduleId,{...options,cursor:page.nextCursor});}
   assert.equal(seen.length,count-1);assert.equal(new Set(seen).size,count-1);assert.equal(bodies,0);
   assert.equal((await otherDrafts.list('spreadsheet')).drafts[0].id,other.id);
   await assert.rejects(otherDrafts.list('spreadsheet',{...options,cursor:first.nextCursor}),{code:'DRAFT_CURSOR'});
   await assert.rejects(f.drafts.list(moduleId,{...options,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
   await assert.rejects(f.drafts.list(moduleId,{...options,cursor:first.nextCursor,limit:9}),{code:'DRAFT_CURSOR'});
   await assert.rejects(f.drafts.list(moduleId,{...options,cursor:first.nextCursor,excludeId:null}),{code:'DRAFT_CURSOR'});
   const bytes=Buffer.from(first.nextCursor,'base64url');bytes[20]^=1;await assert.rejects(f.drafts.list(moduleId,{...options,cursor:bytes.toString('base64url')}),{code:'DRAFT_CURSOR'});
   await assert.rejects(f.drafts.list(moduleId,{limit:21}),{code:'MODULE_INVALID'});
   await assert.rejects(f.drafts.list(moduleId,{}, {signal:AbortSignal.abort()}),{name:'AbortError'});
   const selected=await f.drafts.read(first.drafts[0].id);assert.equal(bodies,1);assert.equal(selected.etag,first.drafts[0].revision);
   t.diagnostic(JSON.stringify({checkpoints:count,firstPageMs:Math.round(elapsed),responseBytes:Buffer.byteLength(JSON.stringify(first)),pageSummaries:10,originalReadsBeforeSelection:0}));
  }finally{ProjectDraftCatalogue.prototype.objectValue=original;ResearchCatalogue.prototype.read=read;}
 }
});

test('module recovery summary and original writes roll back together, detect damage and remove empty checkpoints from discovery',async t=>{
 const f=await fixture(t,2),command=f.commands[0],before=await f.drafts.list(moduleId),put=ProjectDraftCatalogue.prototype.putObject;
 ProjectDraftCatalogue.prototype.putObject=function(id,...args){if(id.startsWith(summary))throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});return put.call(this,id,...args);};
 try{await assert.rejects(f.drafts.write({...command,drafts:command.drafts.map(d=>({...d,data:{name:'Later checkpoint'}}))}),{code:'ENOSPC'});}
 finally{ProjectDraftCatalogue.prototype.putObject=put;}
 assert.deepEqual((await f.drafts.list(moduleId)).drafts,before.drafts);assert.equal((await f.drafts.read(command.id)).etag,command.etag);
 const result=await f.drafts.write({...command,drafts:command.drafts.map(d=>({...d,data:{name:'Later checkpoint'}}))});assert.equal((await f.drafts.list(moduleId)).drafts[0].titles[0],'Later checkpoint');
 await assert.rejects(f.drafts.write({...command,drafts:[]}),{code:'DRAFT_CHANGED'});
 await f.drafts.write({...command,etag:result.etag,drafts:[]});assert.equal((await f.drafts.list(moduleId)).drafts.length,1);assert.deepEqual((await f.drafts.read(command.id)).draft.drafts,[]);
 const remaining=f.commands[1],current=await f.drafts.read(remaining.id),key=await f.draftContext(c=>c.drafts.index.path(current.draft)),raw=await f.draftContext(c=>c.workspace.readMetadata(key,4096));
 await f.draftContext(c=>c.workspace.writeMetadata(key,JSON.stringify({...JSON.parse(raw),titles:['Incorrect cached title']})),true);await assert.rejects(f.drafts.read(remaining.id),{code:'CATALOGUE_DAMAGED'});
 await f.draftContext(c=>c.workspace.writeMetadata(key,raw),true);await f.draftContext(c=>c.store.deleteObject(source+remaining.id+'.json'),true);await assert.rejects(f.drafts.list(moduleId),{code:'CATALOGUE_DAMAGED'});
});

test('older module checkpoints remain readable during a write and build their index on the next checkpoint write',async t=>{
 const f=await fixture(t,14);
 await f.draftContext(async({store})=>{const index=store.objectIndex(),head=await index.head(),ids=[];for await(const item of index.entries(head,'metadata:.observanda/module-draft-list'))ids.push(item.id);for(const id of ids)await store.deleteObject(id);},true);
 const read=ModuleDrafts.prototype.read;let reads=0;
 ModuleDrafts.prototype.read=async function(...args){if(++reads===3)throw Error('Interrupted build');return read.apply(this,args);};
 try{await assert.rejects(f.drafts.list(moduleId),/Interrupted build/);}finally{ModuleDrafts.prototype.read=read;}
 assert.equal(await f.draftContext(c=>c.workspace.readMetadata('.observanda/module-draft-list.json',1024)),null);assert.deepEqual(await f.draftContext(async c=>{const index=c.store.objectIndex(),head=await index.head();return Array.fromAsync(index.entries(head,summary),entry=>entry.id);}),[]);
 const holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await holder.lock();let before;
 try{
  before=await f.drafts.list(moduleId);
  const next=await f.drafts.list(moduleId,{cursor:before.nextCursor}),back=await f.drafts.list(moduleId,{cursor:next.previousCursor});assert.deepEqual(back.drafts,before.drafts);
  assert.equal(await f.draftContext(c=>c.workspace.readMetadata('.observanda/module-draft-list.json',1024)),null);
 }finally{await holder.close();}
 await f.drafts.write(f.commands[0]);assert.notEqual(await f.draftContext(c=>c.workspace.readMetadata('.observanda/module-draft-list.json',1024)),null);
 assert.deepEqual((await f.drafts.list(moduleId)).drafts,before.drafts);
 const selected=await f.drafts.read(before.drafts[0].id);
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault});
 const access=await createAccess('','fresh module recovery secret'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const workspace of [new Workspace(backup,f.vault),new Workspace(fresh,vault)]){
  const drafts=moduleDraftOwners(workspace,f.book.id,moduleId).drafts,page=await drafts.list(moduleId);assert.deepEqual(page.drafts,before.drafts);assert.deepEqual((await drafts.read(selected.draft.id)).draft,selected.draft);
 }
});
