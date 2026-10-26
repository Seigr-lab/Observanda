import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {MetadataFeed} from '../src/metadata-feed.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
async function fixture(t,count=4){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reference-draft-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book,record=book.entries[0],refs=[];
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(async()=>{for(let i=0;i<count;i++)refs.push(await m.retainRecord({...record,title:'Pinned input '+i}));});
 return {...f,m,directory,recordId:record.id,refs};
}
const plan=(f,count,extra={})=>({draftId:randomUUID(),recordId:f.recordId,kind:'collection',title:'Pinned field study',totals:{inputs:count,outputs:0},...extra});
test('collections exceed 500 exact inputs with bounded roots, recover after restore and feed analyses beyond 50 inputs',async t=>{
 const f=await fixture(t,610),command=plan(f,f.refs.length),draft=await f.m.drafts.start(command);
 await assert.rejects(f.m.collection({recordId:f.recordId,title:'Oversized direct request',inputs:f.refs}),{code:'MATERIAL_REFERENCE_LIMIT'});
 await assert.rejects(f.m.analysis({recordId:f.recordId,title:'Oversized direct analysis',inputs:[f.refs[0]],outputs:f.refs,tool:'tool',version:'1',parameters:''}),{code:'MATERIAL_REFERENCE_LIMIT'});
 assert.equal((await f.m.list({recordId:f.recordId,query:'Oversized direct'})).items.length,0);
 for(let offset=0;offset<128;offset+=64)await f.m.drafts.append({id:draft.id,offset,items:f.refs.slice(offset,offset+64)});
 await assert.rejects(f.m.drafts.finish(draft.id),{code:'MATERIAL_DRAFT_INCOMPLETE'});assert.equal(await f.m.current(draft.id),null);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'resume')),{vault:f.vault}),ws=new Workspace(copy,f.vault),m=new ResearchMaterials(ws);
 assert.equal((await m.drafts.read(draft.id)).inputs.count,128);
 for(let offset=128;offset<f.refs.length;offset+=64)await m.drafts.append({id:draft.id,offset,items:f.refs.slice(offset,offset+64)});
 const ref=await m.drafts.finish(draft.id);assert.deepEqual(await m.drafts.finish(draft.id),ref);
 const doc=await m.read(ref);assert.equal(doc.content.inputs,undefined);assert.equal(doc.content.inputsIndex.count,610);assert.ok(JSON.stringify(doc).length<1200);
 const read=m.read.bind(m),seen=[];m.read=async r=>{seen.push(r);return read(r);};
 const page=await m.referencePage(ref,{offset:600});assert.equal(page.items.length,10);assert.equal(seen.length,1);assert.equal(page.items[0].title,'Pinned input 600');m.read=read;
 assert.deepEqual(page.items.map(({kind,id,revision})=>({kind,id,revision})),f.refs.slice(600));
 const analysis=await m.analysis({recordId:f.recordId,title:'External comparison',inputs:[ref,...f.refs.slice(0,60)],tool:'Independent decoder',version:'fixture-1',parameters:'Keep each take separate.'});
 assert.equal((await m.read(analysis)).content.inputsIndex.count,61);
 const revised=await m.collection({recordId:f.recordId,title:'Revised collection',id:ref.id,expectedRevision:ref.revision,inputs:[f.refs[0]]});
 assert.equal((await m.read(ref)).content.inputsIndex.count,610);assert.equal((await m.read(revised)).previous,ref.revision);
 assert.equal((await m.referencePage(analysis)).items[0].revision,ref.revision);
 const open=ws.openCatalogue.bind(ws);let reads=0;ws.openCatalogue=async options=>{reads++;return open(options);};
 const status=(await m.reviewDependencies(f.recordId,{refs:[analysis]})).items[0];ws.openCatalogue=open;
 assert.ok(reads<=32,'Dependency review must share read snapshots instead of opening one per input; got '+reads);
 assert.ok(status.changed.some(i=>i.id===ref.id));assert.equal(status.changed.length,20);assert.equal(status.changedCount,611);
 assert.equal((await m.drafts.list(f.recordId)).items.length,0);
 await m.verify();
 const access=await createAccess('','fresh pinned references key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const backup=await encryptedCopy(await copyPlan(ws.root,path.join(f.directory,'fresh-key')),access,vault,f.vault),restored=new ResearchMaterials(new Workspace(backup,vault));
 assert.deepEqual(await restored.referencePage(ref,{offset:600}),page);await restored.verify();
 // A removed immutable branch cannot be silently treated as an empty collection.
 await restored.workspace.withLock(()=>restored.workspace.removeMetadata('.observanda/materials/sequences/nodes/'+doc.content.inputsIndex.root.hash+'.json'));
 await assert.rejects(restored.verify(),{code:'CATALOGUE_DAMAGED'});
});

test('reference batch receipts fence retries, reject duplicates and roll back partial storage or completion',async t=>{
 const f=await fixture(t),command=plan(f,4),draft=await f.m.drafts.start(command);
 assert.deepEqual(await f.m.drafts.start(command),draft);
 await assert.rejects(f.m.drafts.page({id:draft.id,limit:51}),{code:'MATERIAL_INVALID'});
 const first={id:draft.id,offset:0,items:f.refs.slice(0,2)};
 const received=await f.m.drafts.append(first);assert.deepEqual(await f.m.drafts.append(first),received);
 await assert.rejects(f.m.drafts.append({...first,items:first.items.map(ref=>({...ref,workspaceId:randomUUID()}))}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.drafts.append({...first,items:f.refs.slice(2)}),{code:'MATERIAL_CHANGED'});
 await assert.rejects(f.m.drafts.append({id:draft.id,offset:2,items:[f.refs[0]]}),{code:'MATERIAL_DUPLICATE'});
 await assert.rejects(f.m.drafts.append({id:draft.id,offset:2,items:[{...f.refs[2],workspaceId:randomUUID()}]}),{code:'MATERIAL_INVALID'});
 const write=f.workspace.writeMetadata.bind(f.workspace);
 f.workspace.writeMetadata=async(key,value)=>{await write(key,value);if(key.endsWith('/'+draft.id+'/draft.json'))throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});};
 await assert.rejects(f.m.drafts.append({id:draft.id,offset:2,items:f.refs.slice(2)}),{code:'ENOSPC'});f.workspace.writeMetadata=write;
 assert.equal((await f.m.drafts.read(draft.id)).inputs.count,2);
 await f.m.drafts.append({id:draft.id,offset:2,items:f.refs.slice(2)});
 f.workspace.writeMetadata=async(key,value)=>{await write(key,value);if(key.endsWith('/'+draft.id+'/draft.json'))throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});};
 await assert.rejects(f.m.drafts.finish(draft.id),{code:'ENOSPC'});f.workspace.writeMetadata=write;
 assert.equal(await f.m.current(draft.id),null);assert.equal((await f.m.drafts.read(draft.id)).state,'open');
 const ref=await f.m.drafts.finish(draft.id);assert.equal((await f.m.referencePage(ref)).total,4);assert.deepEqual(await f.m.drafts.finish(draft.id),ref);
 const next=await f.m.drafts.start(plan(f,1));await f.m.drafts.append({id:next.id,offset:0,items:[f.refs[0]]});await f.m.drafts.cancel(next.id);
 await assert.rejects(f.m.drafts.finish(next.id),{code:'MATERIAL_DRAFT_INCOMPLETE'});
 assert.equal(await f.m.current(next.id),null);await f.m.verify();
});

test('analysis outputs stay pinned, unfinished revisions cannot replace concurrent edits and draft listings stay scoped',async t=>{
 const f=await fixture(t),command=plan(f,1,{kind:'analysis',title:'Independent analysis',tool:'External tool',version:'v1',parameters:'Exact inputs.',totals:{inputs:1,outputs:1}}),draft=await f.m.drafts.start(command);
 const session=await f.m.startImport({recordId:f.recordId,name:'results.json',size:2});await f.m.appendImport(session.id,0,[Buffer.from('{}')]);const artifact=await f.m.finishImport(session.id);
 await f.m.drafts.append({id:draft.id,offset:0,items:[f.refs[0]]});
 await assert.rejects(f.m.drafts.append({id:draft.id,slot:'outputs',offset:0,items:[f.refs[1]]}),{code:'MATERIAL_INVALID'});
 await f.m.drafts.append({id:draft.id,slot:'outputs',offset:0,items:[artifact]});const ref=await f.m.drafts.finish(draft.id);
 assert.equal((await f.m.referencePage(ref,{slot:'outputs'})).items[0].revision,artifact.revision);
 const amendment=await f.m.drafts.start({...command,draftId:randomUUID(),id:ref.id,expectedRevision:ref.revision});
 await f.m.drafts.append({id:amendment.id,offset:0,items:[f.refs[1]]});await f.m.drafts.append({id:amendment.id,slot:'outputs',offset:0,items:[artifact]});
 const newer=await f.m.analysis({recordId:f.recordId,id:ref.id,expectedRevision:ref.revision,title:'Concurrent analysis',tool:'Other tool',version:'v2',parameters:'Another interpretation',inputs:[f.refs[2]]});
 await assert.rejects(f.m.drafts.finish(amendment.id),{code:'MATERIAL_CHANGED'});assert.equal((await f.m.current(ref.id)).revision,newer.revision);
 const other=(await f.workspace.read()).book.entries[1].id;
 assert.equal((await f.m.drafts.list(other)).items.length,0);assert.equal((await f.m.drafts.list(f.recordId)).items.length,1);
 await f.m.verify();
});

test('altered or missing accepted-batch receipts fail replay and backup verification visibly',async t=>{
 const f=await fixture(t),draft=await f.m.drafts.start(plan(f,4)),batch={id:draft.id,offset:0,items:f.refs.slice(0,2)};
 await f.m.drafts.append(batch);
 const key='.observanda/materials/drafts/'+draft.id+'/accepted/inputs/0.json',original=await f.workspace.readMetadata(key,1024);
 for(const bytes of ['{',JSON.stringify({hash:'a'.repeat(64),count:2}),JSON.stringify({...JSON.parse(original),count:3})]){
  await f.workspace.withLock(()=>f.workspace.writeMetadata(key,bytes));
  await assert.rejects(f.m.drafts.append(batch),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(f.m.verify(),{code:'CATALOGUE_DAMAGED'});
 }
 await f.workspace.withLock(()=>f.workspace.removeMetadata(key));await assert.rejects(f.m.verify(),{code:'CATALOGUE_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.writeMetadata(key,original));await f.m.verify();
});

test('an unfinished-selection page stays consistent when another client completes a listed draft',async t=>{
 const f=await fixture(t),draft=await f.m.drafts.start(plan(f,1));
 await f.m.drafts.append({id:draft.id,offset:0,items:[f.refs[0]]});
 const original=MetadataFeed.prototype.page;let completed=false;
 MetadataFeed.prototype.page=async function(options){
  const result=await original.call(this,options);
  if(!completed&&this.source.includes('/drafts/by-record/')){completed=true;await f.m.drafts.finish(draft.id);}
  return result;
 };
 try{const listing=await f.m.drafts.list(f.recordId);assert.equal(listing.items[0].state,'open');}
 finally{MetadataFeed.prototype.page=original;}
 assert.equal(completed,true);assert.deepEqual((await f.m.drafts.list(f.recordId)).items,[]);
});
