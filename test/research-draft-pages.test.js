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
import {ResearchDrafts} from '../src/research-drafts.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {recordRevision} from '../src/research.js';
import {ObjectIndex} from '../src/object-index.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
const source='metadata:.observanda/drafts/';
async function fixture(t,count=14){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-draft-pages-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const drafts=new ResearchDrafts(f.workspace),commands=[];
 for(let i=0;i<count;i++){
  const base=book.entries[0],command={id:randomUUID(),workspaceId:book.id,expectedRevision:null,changes:[{base,expectedRevision:recordRevision(base),record:{...base,title:'Draft '+i,body:'Private working source '.repeat(1800)}}]};
  const result=await drafts.write(command);commands.push({...command,expectedRevision:result.revision});
 }
 return {...f,directory,book,drafts,commands};
}
test('recovery pages and reverse ranges stay bounded without reading draft or record bodies',async t=>{
 for(const count of [14,140]){
  const f=await fixture(t,count),original={read:ResearchDrafts.prototype.read,objectValue:ResearchCatalogue.prototype.objectValue,readBook:ResearchCatalogue.prototype.read};
  let summaries=0;
  ResearchDrafts.prototype.read=()=>{throw Error('Draft body loaded for discovery');};
  ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded');};
  ResearchCatalogue.prototype.objectValue=function(id,...args){assert.ok(!id.startsWith(source));if(id.startsWith('metadata:.observanda/draft-list/'))summaries++;return original.objectValue.call(this,id,...args);};
  try{
   const first=await f.drafts.list({workspaceId:f.book.id,excludeId:f.commands.at(-1).id});
   assert.equal(first.drafts.length,10);assert.equal(first.previousCursor,null);assert.ok(first.nextCursor);assert.equal(summaries,10);
   assert.ok(JSON.stringify(first).length<12000);assert.ok(!JSON.stringify(first).includes('Private working source'));
   const second=await f.drafts.list({workspaceId:f.book.id,excludeId:f.commands.at(-1).id,cursor:first.nextCursor});
   const back=await f.drafts.list({workspaceId:f.book.id,excludeId:f.commands.at(-1).id,cursor:second.previousCursor});
   assert.deepEqual(back.drafts,first.drafts);
   const seen=first.drafts.map(d=>d.id);let page=second;
   for(;;){seen.push(...page.drafts.map(d=>d.id));assert.ok(page.drafts.length<=10);if(!page.nextCursor)break;page=await f.drafts.list({workspaceId:f.book.id,excludeId:f.commands.at(-1).id,cursor:page.nextCursor});}
   assert.equal(new Set(seen).size,count-1);assert.equal(seen.length,count-1);
   await assert.rejects(f.drafts.list({workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
   await assert.rejects(f.drafts.list({cursor:first.nextCursor,excludeId:null}),{code:'DRAFT_CURSOR'});
   await assert.rejects(f.drafts.list({cursor:first.nextCursor,excludeId:f.commands.at(-1).id,limit:9}),{code:'DRAFT_CURSOR'});
   const bytes=Buffer.from(first.nextCursor,'base64url');bytes[20]^=1;
   await assert.rejects(f.drafts.list({cursor:bytes.toString('base64url')}),{code:'DRAFT_CURSOR'});
   await assert.rejects(f.drafts.list({limit:21}),{code:'INVALID'});
   await assert.rejects(f.drafts.list({}, {signal:AbortSignal.abort()}),{name:'AbortError'});
  }finally{ResearchDrafts.prototype.read=original.read;ResearchCatalogue.prototype.objectValue=original.objectValue;ResearchCatalogue.prototype.read=original.readBook;}
  t.diagnostic(count+' checkpoints: ten summaries per page, no draft bodies or record bodies.');
 }
});
test('checkpoint and summary updates roll back together; selected reads detect inconsistent summaries',async t=>{
 const f=await fixture(t,2),command=f.commands[0],before=await f.drafts.list(),put=ResearchCatalogue.prototype.putObject;
 ResearchCatalogue.prototype.putObject=function(id,value){if(id.startsWith('metadata:.observanda/draft-list/'))throw Error('Interrupted summary write');return put.call(this,id,value);};
 try{await assert.rejects(f.drafts.write({...command,changes:command.changes.map(c=>({...c,record:{...c.record,title:'Later draft'}}))}),/Interrupted summary/);}
 finally{ResearchCatalogue.prototype.putObject=put;}
 assert.deepEqual(await f.drafts.list(),before);assert.equal((await f.drafts.read(command.id)).revision,command.expectedRevision);
 const result=await f.drafts.write({...command,changes:command.changes.map(c=>({...c,record:{...c.record,title:'Later draft'}}))});
 assert.equal((await f.drafts.list()).drafts[0].titles[0],'Later draft');
 await assert.rejects(f.drafts.remove({id:command.id,workspaceId:f.book.id,expectedRevision:command.expectedRevision}),{code:'DRAFT_CHANGED'});
 assert.equal((await f.drafts.read(command.id)).draft.changes[0].record.title,'Later draft');
 await f.drafts.remove({id:command.id,workspaceId:f.book.id,expectedRevision:result.revision});
 assert.equal((await f.drafts.list()).drafts.length,1);
 const remaining=f.commands[1],current=await f.drafts.read(remaining.id);
 const key='.observanda/draft-list/'+String(9999999999999-Date.parse(current.draft.updatedAt)).padStart(13,'0')+'-'+remaining.id+'.json';
 const summary=await f.workspace.readMetadata(key,4096);
 await f.workspace.withLock(()=>f.workspace.writeMetadata(key,JSON.stringify({...JSON.parse(summary),titles:['Incorrect cached title']})));
 await assert.rejects(f.drafts.read(remaining.id),{code:'CATALOGUE_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.writeMetadata(key,summary));
 await f.workspace.withLock(()=>f.workspace.catalogue(s=>s.deleteObject(source+remaining.id+'.json')));
 await assert.rejects(f.drafts.list(),{code:'CATALOGUE_DAMAGED'});
});
test('older checkpoints build summaries transactionally and remain recoverable after copy and fresh-key restore',async t=>{
 const f=await fixture(t,14),commands=f.commands;
 await f.workspace.withLock(()=>f.workspace.catalogue(async s=>{
  const ids=await s.objectIds('metadata:.observanda/draft-list');for(const id of ids)await s.deleteObject(id);
 }));
 const originalRead=ResearchDrafts.prototype.read;let reads=0;
 ResearchDrafts.prototype.read=async function(...args){if(++reads===3)throw Error('Interrupted index build');return originalRead.apply(this,args);};
 try{await assert.rejects(f.drafts.list(),/Interrupted index/);}finally{ResearchDrafts.prototype.read=originalRead;}
 assert.equal(await f.workspace.readMetadata('.observanda/draft-list.json',1024),null);
 assert.deepEqual(await f.workspace.catalogue(s=>s.objectIds('metadata:.observanda/draft-list/')),[]);
 const before=await f.drafts.list();assert.equal(before.drafts.length,10);
 assert.equal(await f.workspace.readMetadata('.observanda/draft-list.json',1024),null);
 await f.drafts.write(commands[0]);assert.notEqual(await f.workspace.readMetadata('.observanda/draft-list.json',1024),null);
 for(const command of commands)assert.equal((await f.drafts.read(command.id)).revision,command.expectedRevision);
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault});
 const access=await createAccess('','fresh recovery secret'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const ws of [new Workspace(backup,f.vault),new Workspace(fresh,vault)]){
  const store=new ResearchDrafts(ws),page=await store.list();assert.deepEqual(page.drafts,before.drafts);
  assert.deepEqual((await store.read(commands[0].id)).draft,(await f.drafts.read(commands[0].id)).draft);
 }
 await f.workspace.catalogue(async s=>{
  const index=new ObjectIndex(s),head=await index.head(),prefix='metadata:.observanda/draft-list/';
  const forward=await Array.fromAsync(index.entries(head,prefix)),backward=await Array.fromAsync(index.reverseEntries(head,prefix));
  assert.deepEqual(backward,forward.toReversed());
  assert.deepEqual(await Array.fromAsync(index.reverseEntries(head,prefix,forward[4].id)),forward.slice(0,4).reverse());
 });
});
