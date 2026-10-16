import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {recordUpdateReader} from '../src/web/record-update-reader.js';
import {applyRecordPatch} from '../src/web/record-patch.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';

async function fixture(t,count=65,{large=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-updates-')),book=sampleNotebook(),seed=book.entries[2];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Record '+i,body:'Private source '+i,sections:large?Array.from({length:6},()=>({id:randomUUID(),title:'Notes',body:'x'.repeat(59000)})):[],relations:[],attachments:[],figures:[],contributors:[]}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const base=await f.workspace.read();return {...f,directory,base,reader:new WorkspaceReader(f.workspace)};
}
async function changeAll(f){const draft=structuredClone(f.base.book);draft.entries.forEach((r,i)=>{r.title='Updated '+i;});return f.workspace.save(draft,f.base.etag);}
const consume=(reader,first)=>recordUpdateReader((route,data,options)=>reader.changePage(data,options),first).read();

test('changed originals and explicit order arrive in bounded pinned pages at 65 and 650 records',async t=>{
 for(const count of [65,650]){
  const f=await fixture(t,count),draft=structuredClone(f.base.book);
  draft.entries.forEach((r,i)=>r.title='Updated '+i);draft.entries.splice(3,1);draft.entries.push({...draft.entries[0],id:randomUUID(),title:'New record'});draft.entries.reverse();
  const saved=await f.workspace.save(draft,f.base.etag),original={record:ResearchCatalogue.prototype.record,read:ResearchCatalogue.prototype.read},node=SnapshotIndex.prototype.node;
  let bodies=0,nodes=0,pages=0,largest=0,maxNodes=0;
  t.mock.method(ResearchCatalogue.prototype,'record',function(...args){bodies++;return original.record.apply(this,args);});
  t.mock.method(ResearchCatalogue.prototype,'read',()=>{throw Error('Full body assembly');});
  t.mock.method(SnapshotIndex.prototype,'node',function(...args){nodes++;return node.apply(this,args);});
  const measured=async operation=>{bodies=0;nodes=0;const value=await operation();assert.ok(bodies<=20);const orderPage=value.page?.phase==='order';assert.ok(nodes<(orderPage?128*(2*Math.ceil(Math.log2(count+1))+2):400),'Bounded seek/ownership reads: '+nodes);maxNodes=Math.max(maxNodes,nodes);largest=Math.max(largest,Buffer.byteLength(JSON.stringify(value)));pages++;return value;};
  const start=performance.now(),first=await measured(()=>f.reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag}));
  assert.ok(first.recordUpdate);assert.ok(first.recordUpdate.page.records.length<=20);
  const result=await recordUpdateReader((route,data,options)=>measured(()=>f.reader.changePage(data,options)),first).read();
  const elapsed=performance.now()-start,patched=applyRecordPatch(f.base.book,f.base.etag,recordRevisions(f.base.book),result);
  assert.deepEqual(patched.book,saved.book);assert.equal(patched.book.entries[0].title,'New record');assert.equal(result.recordPatch.order.length,count);
  assert.ok(elapsed<15000);assert.ok(largest<128*1024);
  t.mock.restoreAll();t.diagnostic(JSON.stringify({count,pages,maxNodes,largestPageBytes:largest,ms:Math.round(elapsed)}));
 }
});

test('concurrent writes and lost pages do not move the target or repeat completed reads',async t=>{
 const f=await fixture(t),saved=await changeAll(f),first=await f.reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag}),calls=[];
 const record=saved.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:saved.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Later edit'}}]});
 let fail=true;
 const client=recordUpdateReader(async(route,data,options)=>{calls.push(data.cursor);const result=await f.reader.changePage(data,options);if(fail&&calls.length===2){fail=false;throw Error('Lost reply');}return result;},first);
 await assert.rejects(client.read(),/Lost reply/);assert.equal(f.base.book.entries[0].title,'Record 0');
 const result=await client.read();assert.equal(calls[1],calls[2]);assert.equal(calls.filter(v=>v===calls[0]).length,1);
 assert.equal(result.etag,saved.etag);assert.deepEqual(applyRecordPatch(f.base.book,f.base.etag,recordRevisions(f.base.book),result).book,saved.book);
 const latest=await f.workspace.read();assert.equal(latest.book.entries[0].title,'Later edit');
});
test('compatibility updates stop at their own count and byte budgets while selected authoring continues',async t=>{
 const f=await fixture(t,3,{large:true}),service=new ResearchRecords(f.workspace,{});
 for(const prior of f.base.book.entries){
  const record={...prior,sections:[...prior.sections,...prior.sections.map(s=>({...s,id:randomUUID()}))]};
  await service.save({workspaceId:f.base.book.id,changes:[{id:prior.id,expectedRevision:recordRevision(prior),record}]},{recordIds:[prior.id]});
 }
 const first=await f.reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag});
 assert.throws(()=>recordUpdateReader(()=>assert.fail('No continuation expected'),{...first,recordUpdate:{...first.recordUpdate,count:1001}}),{code:'WORKSPACE_READ_LIMIT'});
 await assert.rejects(consume(f.reader,first),{code:'WORKSPACE_READ_LIMIT'});
 assert.equal((await f.reader.selection({workspaceId:f.base.book.id,ids:[f.base.book.entries[0].id]})).book.entries[0].sections.length,12);
});

test('large originals travel alone; malformed, cross-workspace, cancelled and damaged updates fail closed',async t=>{
 const f=await fixture(t,3,{large:true});await changeAll(f);
 const first=await f.reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag});assert.equal(first.recordUpdate.page.records.length,1);
 const command={workspaceId:f.base.book.id,cursor:first.recordUpdate.page.nextCursor};
 const bytes=Buffer.from(command.cursor,'base64url');bytes[bytes.length-1]^=1;
 await assert.rejects(f.reader.changePage({...command,cursor:bytes.toString('base64url')}),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(f.reader.changePage({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(f.reader.changePage({...command,extra:true}),{code:'INVALID'});
 await assert.rejects(f.reader.changePage(command,{signal:AbortSignal.abort()}),{name:'AbortError'});
 for(const mutate of [p=>p.etag='a'.repeat(64),p=>p.page.offset++,p=>p.page.records.push(p.page.records[0]),p=>p.page.phase='order']){
  const client=recordUpdateReader(async(route,data)=>{const result=await f.reader.changePage(data);mutate(result);return result;},first);await assert.rejects(client.read(),{code:'WORKSPACE_READ_INVALID'});
 }
 const second=await f.reader.changePage(command),target=second.page.records[0].record.id;
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM records WHERE id=$1',target)));
 await assert.rejects(f.reader.changePage(command),{code:'CATALOGUE_DAMAGED'});
});

test('partial updates survive ordinary and fresh-key backup without mutable read sessions',async t=>{
 const f=await fixture(t),saved=await changeAll(f),first=await f.reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag});
 const normal=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault});
 const access=await createAccess('','record update copy password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 assert.deepEqual(applyRecordPatch(f.base.book,f.base.etag,recordRevisions(f.base.book),await consume(new WorkspaceReader(new Workspace(normal,f.vault)),first)).book,saved.book);
 // A fresh key rejects the old capability; restarting the same pinned delta
 // regenerates its pages under the new key without changing record identities.
 const reader=new WorkspaceReader(new Workspace(fresh,vault));
 await assert.rejects(consume(reader,first),{code:'WORKSPACE_READ_CURSOR'});
 const renewed=await reader.changes({workspaceId:f.base.book.id,baseEtag:f.base.etag});
 assert.deepEqual(applyRecordPatch(f.base.book,f.base.etag,recordRevisions(f.base.book),await consume(reader,renewed)).book,saved.book);
});
