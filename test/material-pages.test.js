import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-material-pages-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return {...f,directory,materials,book};
}
const create=(m,recordId,title,inputs=[])=>m.commit({kind:'collection',recordId,title,content:{inputs}});

test('material pages use selected scope branches, keep identities across revisions and authenticate cursors',async t=>{
 const {workspace:ws,materials:m,book}=await fixture(t),recordId=book.entries[0].id,other=book.entries[1].id,refs=[];
 await ws.withLock(async()=>{for(let i=0;i<63;i++)refs.push(await create(m,recordId,'Collection '+i));for(let i=0;i<147;i++)await create(m,other,'Unrelated '+i);});
 m.heads=()=>{throw Error('Global material scan');};ws.listMetadata=()=>{throw Error('Global metadata scan');};
 const current=m.current.bind(m);let readIds=[];m.current=async id=>{readIds.push(id);return current(id);};
 const first=await m.list({recordId,limit:10});assert.equal(first.items.length,10);assert.equal(readIds.length,10);assert.ok(first.next);
 assert.ok(first.items.every(i=>i.recordId===recordId));
 const selected=first.items[0],before=await m.read(selected);
 await ws.withLock(()=>m.commit({kind:selected.kind,id:selected.id,recordId,expectedRevision:selected.revision,title:'Amended collection',content:{inputs:[]}}));
 assert.deepEqual(await m.read(selected),before);
 const second=await m.list({recordId,limit:10,cursor:first.next});assert.equal(second.changed,true);
 const seen=[...first.items,...second.items];let cursor=second.next;
 while(cursor){const page=await m.list({recordId,limit:10,cursor});seen.push(...page.items);cursor=page.next;}
 assert.equal(seen.length,63);assert.equal(new Set(seen.map(i=>i.id)).size,63);
 assert.deepEqual(new Set(seen.map(i=>i.id)),new Set(refs.map(i=>i.id)));
 for(const change of [{recordId:other},{kind:'analysis'},{query:'abc'},{limit:11}])await assert.rejects(m.list({recordId,limit:10,cursor:first.next,...change}),{code:'INVALID'});
 const bytes=Buffer.from(first.next,'base64url');bytes[bytes.length-2]^=1;
 await assert.rejects(m.list({recordId,limit:10,cursor:bytes.toString('base64url')}),{code:'INVALID'});
 const match=await m.list({recordId,query:'Amended',limit:10});assert.equal(match.items.length,1);assert.equal(match.items[0].id,selected.id);
 readIds=[];const empty=await m.list({query:'No matching title'});assert.equal(empty.scanned,200);assert.equal(readIds.length,200);assert.equal(empty.items.length,0);assert.ok(empty.next);
 const last=await m.list({query:'No matching title',cursor:empty.next});assert.equal(last.scanned,10);assert.equal(last.next,null);
 readIds=[];const data=await m.overview(recordId,{limit:5});assert.equal(data.items.length,5);assert.equal(readIds.length,5);
});

test('dependency review uses point heads and retained input summaries, not dataset manifests or other records',async t=>{
 const {workspace:ws,materials:m,book}=await fixture(t),recordId=book.entries[0].id;let source,result;
 await ws.withLock(async()=>{
  source=await create(m,recordId,'Source');
  const intermediate=await create(m,recordId,'Intermediate',[source]);
  result=await create(m,recordId,'Result',[intermediate]);
  await m.commit({kind:'collection',id:source.id,recordId,expectedRevision:source.revision,title:'Changed source',content:{inputs:[]}});
 });
 const read=m.read.bind(m);m.heads=()=>{throw Error('Global scan');};m.read=()=>{throw Error('Large retained manifest loaded');};
 const data=await m.overview(recordId);
 const item=data.items.find(i=>i.id===result.id);assert.equal(item.changed.length,1);assert.equal(item.changed[0].revision,source.revision);assert.notEqual(item.changed[0].current,source.revision);
 m.read=read;
});

test('failed material commits and interrupted imports restore with their index and exact original bytes',async t=>{
 const f=await fixture(t),{workspace:ws,materials:m,book}=f,recordId=book.entries[0].id;
 const session=await m.startImport({recordId,name:'capture.bin',size:5});
 await m.appendImport(session.id,0,[Buffer.from([0,1,2,3,255])]);
 const put=ws.writeMetadata.bind(ws);ws.writeMetadata=async(name,value)=>{await put(name,value);if(name.endsWith('/index/state.json'))throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});};
 await assert.rejects(ws.withLock(()=>create(m,recordId,'Must roll back')),{code:'ENOSPC'});ws.writeMetadata=put;
 assert.equal((await m.list({recordId})).items.length,0);assert.equal((await m.overview(recordId)).imports.length,1);
 const backup=await copyWorkspace(await copyPlan(ws.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(backup,f.vault));
 const pending=(await restored.overview(recordId)).imports[0];assert.equal(pending.id,session.id);assert.equal(pending.receivedChunks,1);
 const original=await restored.finishImport(session.id);
 assert.equal((await restored.overview(recordId)).imports.length,0);assert.equal((await restored.list({recordId})).items[0].id,original.id);
 const {content}=await restored.artifact(original),chunks=[];for await(const chunk of content.read())chunks.push(chunk);
 assert.deepEqual(Buffer.concat(chunks),Buffer.from([0,1,2,3,255]));
 assert.equal((await restored.verify()).originalBytes,5);
 // Corrupted cached dependencies must not pass an explicit integrity check.
 await restored.workspace.withLock(()=>restored.workspace.writeMetadata('.observanda/materials/index/dependencies/'+original.id+'/'+original.revision+'.json',JSON.stringify({...original,inputs:[{kind:'collection',id:original.id,revision:original.revision}]})));
 await assert.rejects(restored.verify(),{code:'CATALOGUE_DAMAGED'});
});

test('workspace outlines have no editable record array and never load membership or record bodies',async t=>{
 const {workspace:ws,book}=await fixture(t),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,manifest=ResearchCatalogue.prototype.manifest;
 const fail=()=>{throw Error('Whole records loaded for workspace metadata');};
 ResearchCatalogue.prototype.read=fail;ResearchCatalogue.prototype.record=fail;ResearchCatalogue.prototype.manifest=fail;
 try{
  const result=await ws.outline();assert.equal(result.metadata.id,book.id);assert.equal(result.metadata.title,book.title);assert.equal(result.recordCount,book.entries.length);
  assert.equal(result.book,undefined);assert.equal(result.metadata.entries,undefined);assert.match(result.etag,/^[a-f0-9]{64}$/);
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.manifest=manifest;}
});

test('an existing material index builds atomically in place and explicit verification detects missing discovery links',async t=>{
 const {workspace:ws,materials:m,book}=await fixture(t),recordId=book.entries[0].id;
 await ws.withLock(async()=>{for(let i=0;i<3;i++)await create(m,recordId,'Existing '+i);});
 const prefix='metadata:.observanda/materials/index/';
 await ws.withLock(()=>ws.catalogue(async store=>{for(const id of await store.objectIds(prefix))await store.deleteObject(id);}));
 const put=ws.writeMetadata.bind(ws);let count=0;
 ws.writeMetadata=async(name,value)=>{await put(name,value);if(name.includes('/heads/')&&++count===2)throw Error('Interrupted index build');};
 await assert.rejects(m.list({recordId}),/Interrupted index build/);ws.writeMetadata=put;
 assert.equal(await ws.readMetadata('.observanda/materials/index/state.json',1024),null);
 const page=await m.list({recordId});assert.equal(page.items.length,3);assert.equal((await m.verify()).revisions,3);
 const head=page.items[0],item=JSON.parse(await ws.readMetadata('.observanda/materials/index/items/'+head.id+'.json',2048)),feed=m.index.feed(recordId);
 await ws.withLock(()=>ws.removeMetadata(feed.order+'/'+feed.key(item)));
 await assert.rejects(m.verify(),{code:'CATALOGUE_DAMAGED'});
});

test('dependency review resolves changed record revisions from authenticated summaries',async t=>{
 const {workspace:ws,materials:m,book}=await fixture(t),recordId=book.entries[0].id,other=book.entries[1];let result;
 await ws.withLock(async()=>{
  const pinned=await m.retainRecord(other),source=await create(m,recordId,'Source record',[pinned]);
  result=await create(m,recordId,'Derived result',[source,pinned]);
 });
 await new ResearchRecords(ws,{}).save({workspaceId:book.id,changes:[{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'Changed after acquisition'}}]},{compact:true});
 const read=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){assert.equal(id,recordId,'Related original body loaded for a revision check');return read.call(this,id,...args);};
 try{
  const item=(await m.overview(recordId)).items.find(item=>item.id===result.id);
  assert.equal(item.changedCount,1);assert.equal(item.changed[0].id,other.id);assert.equal(item.changed[0].revision,recordRevision(other));assert.notEqual(item.changed[0].current,recordRevision(other));
 }finally{ResearchCatalogue.prototype.record=read;}
});

test('first publication review initializes discovery before pinning its read and empty scopes stay read-only',async t=>{
 const {workspace:ws,materials:m,book}=await fixture(t),saved=await ws.read();
 assert.deepEqual(await m.releaseSources(saved.book,book.entries.map(r=>r.id),{sourceEtag:saved.etag}),{sources:[],warnings:[]});
 const write=ws.writeMetadata;ws.writeMetadata=()=>{throw Error('Empty material scope wrote metadata during a read');};
 try{
  assert.deepEqual(await m.releaseSources(saved.book,book.entries.map(r=>r.id),{sourceEtag:saved.etag}),{sources:[],warnings:[]});
  assert.deepEqual((await m.overview(book.entries[0].id)).items,[]);
 }finally{ws.writeMetadata=write;}
});
