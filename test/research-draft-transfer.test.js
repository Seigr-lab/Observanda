import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {largeRecordBook} from './record-capacity-fixture.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {ResearchDraftTransfer} from '../src/research-draft-transfer.js';
import {RecordDraftChunks} from '../src/record-draft-chunks.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {recordRevision} from '../src/research.js';
import {digest,Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {writeRecordCheckpoint,readRecordCheckpoint} from '../src/web/record-draft-transfer.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../src/web/record-draft-protocol.js';
import {ResearchDraftContent} from '../src/research-draft-content.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {verifyRetainedDraft} from '../src/research-draft-verification.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {RecordDocument} from '../src/record-document.js';

function apiFor(workspace,observe=()=>{}){
 return async(route,command)=>{
  observe(route,command);if(route.includes('/transfer/'))return new ResearchDraftTransfer(workspace)[route.split('/').at(-1)](command);
  const drafts=new ResearchDrafts(workspace);return route.endsWith('/read')?drafts.read(command.id,{header:true}):drafts.write(command);
 };
}
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-draft-blocks-')),book=largeRecordBook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const base=book.entries[0],record={...base,title:'Large unfinished observation',sections:Array.from({length:42},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'界𝛑'.repeat(20000)}))};
 const command={id:randomUUID(),workspaceId:book.id,expectedRevision:null,changes:[{record,expectedRevision:recordRevision(base),baseRevision:recordRevision(base)}]};
 return {...f,directory,book,base,command};
}

test('large checkpoints use bounded authenticated requests, preserve base history and restore through both backup modes',async t=>{
 const f=await fixture(t),calls=[],api=apiFor(f.workspace,(route,data)=>calls.push({route,bytes:Buffer.byteLength(JSON.stringify(data))})),drafts=new ResearchDrafts(f.workspace);
 const start=performance.now(),saved=await writeRecordCheckpoint(api,f.command);assert.equal((await writeRecordCheckpoint(api,f.command)).revision,saved.revision);
 const header=await drafts.read(f.command.id,{header:true});assert.equal(header.draft.formatVersion,4);assert.ok(header.draft.content.bytes>5*1024*1024);
 assert.ok(Buffer.byteLength(JSON.stringify(header))<2048);assert.ok(calls.every(c=>c.bytes<2*SIZE));
 const original=ResearchCatalogue.prototype.record,reads=[];t.mock.method(ResearchCatalogue.prototype,'record',function(...args){reads.push(args[0]);return original.apply(this,args);});
 assert.equal((await drafts.list({workspaceId:f.book.id})).drafts[0].revision,saved.revision);assert.deepEqual(reads,[]);
 const content=new ResearchDraftContent(f.workspace),selected=[];
 const treeRead=RecordValueTree.prototype.read;t.mock.method(RecordValueTree.prototype,'read',async function(revision){const value=await treeRead.call(this,revision);if(value?.title?.startsWith('Observation '))selected.push(value.title);return value;});
 const last=await content.read({id:f.command.id,workspaceId:f.book.id,expectedRevision:saved.revision,offset:40});
 assert.deepEqual(last.sections.values,f.command.changes[0].record.sections.slice(40));assert.equal(last.sections.total,42);assert.equal(last.body,null);assert.deepEqual(selected,['Observation 40','Observation 41']);assert.deepEqual(reads,[]);
 await assert.rejects(content.read({id:f.command.id,workspaceId:f.book.id,expectedRevision:'0'.repeat(64),offset:40}),{code:'DRAFT_CHANGED'});
 const recovered=await readRecordCheckpoint(api,f.command.id);assert.deepEqual(recovered.draft.changes[0].record,f.command.changes[0].record);assert.deepEqual(recovered.draft.changes[0].base,f.base);assert.deepEqual(reads,[f.base.id]);t.mock.restoreAll();
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault}),access=await createAccess('','record blocks recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const ws of [new Workspace(backup,f.vault),new Workspace(fresh,vault)]){
  const result=await readRecordCheckpoint(apiFor(ws),f.command.id);assert.equal(result.revision,saved.revision);assert.deepEqual(result.draft.changes,recovered.draft.changes);
  assert.deepEqual((await new ResearchDraftContent(ws).read({id:f.command.id,workspaceId:f.book.id,expectedRevision:saved.revision,offset:40})).sections,last.sections);
 }
 t.diagnostic(JSON.stringify({draftBytes:header.draft.content.bytes,chunks:header.draft.content.root.count,maxRequestBytes:Math.max(...calls.map(c=>c.bytes)),recoveryAndBackupMs:Math.round(performance.now()-start)}));
});

test('checkpoint verification rejects a separately valid field tree that disagrees with its retained transport',async t=>{
 const f=await fixture(t);await writeRecordCheckpoint(apiFor(f.workspace),f.command);
 const {draft}=await new ResearchDrafts(f.workspace).read(f.command.id,{header:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  await verifyRetainedDraft(store,draft);
  await withDraftDocument(store,draft,async source=>{
   const mutable=new RecordDocument(source.blocks,source.root,{mutable:true});
   for(const [field,value] of [[['sections','41','body'],'Different retained content'],[['sections'],[]]]){
    const changed=await mutable.replace(field,value);await changed.blocks.flush();
    await assert.rejects(verifyRetainedDraft(store,{...draft,document:{...draft.document,root:changed.root}}),{code:'CATALOGUE_DAMAGED'});
   }
  });
 }));
});

test('interrupted and failed replacements preserve the last checkpoint; stale, incomplete and corrupted blocks are rejected',async t=>{
 const f=await fixture(t),drafts=new ResearchDrafts(f.workspace),transfer=new ResearchDraftTransfer(f.workspace),api=apiFor(f.workspace);
 const saved=await writeRecordCheckpoint(api,f.command),next={...f.command,expectedRevision:saved.revision,changes:[{...f.command.changes[0],record:{...f.command.changes[0].record,title:'Later observations'}}]};
 let stopped=false;
 await assert.rejects(writeRecordCheckpoint(async(route,data)=>{const result=await api(route,data);if(route.endsWith('/part')&&data.index===2&&!stopped){stopped=true;throw Error('Lost response');}return result;},next),/Lost response/);
 assert.equal((await drafts.read(f.command.id,{header:true})).revision,saved.revision);
 const manifest=JSON.parse(await f.workspace.readMetadata('.observanda/record-draft-transfers/'+f.command.id+'.json',8192));
 assert.equal((await transfer.start({id:next.id,workspaceId:next.workspaceId,expectedRevision:next.expectedRevision,bytes:manifest.content.bytes,sha256:manifest.content.sha256})).receivedChunks,3);
 await assert.rejects(transfer.finish({id:next.id,workspaceId:next.workspaceId,transferHash:manifest.content.sha256}),{code:'INVALID'});
 const put=ResearchCatalogue.prototype.putObject;t.mock.method(ResearchCatalogue.prototype,'putObject',function(id,...args){if(id.startsWith('metadata:.observanda/draft-list/'))throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});return put.call(this,id,...args);});
 await assert.rejects(writeRecordCheckpoint(api,next),{code:'ENOSPC'});t.mock.restoreAll();assert.equal((await drafts.read(next.id,{header:true})).revision,saved.revision);
 const controller=new AbortController();controller.abort();await assert.rejects(transfer.finish({id:next.id,workspaceId:next.workspaceId,transferHash:manifest.content.sha256},{signal:controller.signal}),{name:'AbortError'});
 const resumed=await writeRecordCheckpoint(apiFor(new Workspace(f.workspace.root,f.vault)),next);assert.notEqual(resumed.revision,saved.revision);
 await assert.rejects(transfer.readPart({id:next.id,workspaceId:next.workspaceId,expectedRevision:saved.revision,index:0}),{code:'DRAFT_CHANGED'});
 await assert.rejects(writeRecordCheckpoint(api,f.command),{code:'DRAFT_CHANGED'});
 const header=await drafts.read(next.id,{header:true}),chunks=new RecordDraftChunks(f.workspace,next.id);
 assert.equal((await f.workspace.listMetadata(chunks.prefix+'/chunks')).length,header.draft.content.root.count);
 assert.equal((await f.workspace.listMetadata(chunks.prefix+'/nodes')).length,header.draft.content.root.count);
 const block=await chunks.part(header.draft.content,header.draft.content.root.count-1);assert.ok(block.length<=SIZE);
 // A valid encrypted metadata write cannot substitute bytes under a pinned hash.
 await f.workspace.withLock(async()=>{
  const index=chunks.tree(),entry=await index.find({root:header.draft.content.root},'chunk:'+String(0).padStart(16,'0'));
  await f.workspace.writeMetadata(chunks.prefix+'/chunks/'+entry.revision+'.json',JSON.stringify({bytes:Buffer.from('wrong').toString('base64')}));
 });
 await assert.rejects(chunks.part(header.draft.content,0),{code:'CATALOGUE_DAMAGED'});
 // Removing a damaged draft only needs its authenticated header, not its body.
 await drafts.remove({id:next.id,workspaceId:next.workspaceId,expectedRevision:resumed.revision});assert.equal((await drafts.list()).drafts.length,0);
 assert.deepEqual(await f.workspace.listMetadata(chunks.prefix+'/chunks'),[]);assert.deepEqual(await f.workspace.listMetadata(chunks.prefix+'/nodes'),[]);
});

test('untrusted transfer payloads cannot commit invalid records or a false digest',async t=>{
 const f=await fixture(t),transfer=new ResearchDraftTransfer(f.workspace),drafts=new ResearchDrafts(f.workspace);
 for(const [text,falseHash] of [[JSON.stringify([{...f.command.changes[0],record:{...f.base,sections:[{id:randomUUID(),title:'Invalid',body:'x'.repeat(60001)}]}}]),false],[JSON.stringify(f.command.changes),true]]){
  const bytes=Buffer.from(text),sha256=falseHash?'0'.repeat(64):digest(bytes),owner={id:randomUUID(),workspaceId:f.book.id};
  await transfer.start({...owner,expectedRevision:null,bytes:bytes.length,sha256});
  for(let index=0;index*SIZE<bytes.length;index++){const chunk=bytes.subarray(index*SIZE,(index+1)*SIZE);await transfer.part({...owner,transferHash:sha256,index,bytes:chunk.toString('base64'),sha256:digest(chunk)});}
  await assert.rejects(transfer.finish({...owner,transferHash:sha256}),{code:falseHash?'CATALOGUE_DAMAGED':'INVALID'});assert.equal(await drafts.read(owner.id),null);
 }
});
