import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {encryptedCopy,copyPlan} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {RecordWriting} from '../src/record-writing.js';
import {RecordValues} from '../src/record-values.js';
import {RecordHistory} from '../src/record-history.js';
import {StructureCommands} from '../src/structure-commands.js';
import {withRecordDocument} from '../src/record-document.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';

async function setup(t,{large=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-structure-doc-')),book=sampleNotebook(),record=book.entries[0];
 book.projects.push({...book.projects[0],id:randomUUID(),title:'Other project'});
 const destination={...book.notebooks[0],id:randomUUID(),title:'Destination'};book.notebooks.push(destination);
 record.sections=Array.from({length:large?73:4},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Recorded '+i+' '+('exact'.repeat(large?5600:1500))}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=f.workspace,writing=new RecordWriting(workspace),target={workspaceId:book.id,recordId:record.id,sectionId:null},summary=await writing.read(target);
 record.body='Extended observations '.repeat(2500);await writing.save({...target,expectedRevision:summary.revision,value:{body:record.body}});
 return {...f,directory,book,record,destination,workspace,service:new StructureCommands(workspace)};
}
const move=(f,etag)=>({commandId:randomUUID(),response:'outline',etag,change:{kind:'delete-notebook',value:{id:f.book.notebooks[0].id,records:'move',destinationId:f.destination.id,confirmed:true}}});

test('heavy notebook moves retain every block, scope key, history and portable recovery without full-record reads',async t=>{
 const f=await setup(t,{large:true}),{book,record,workspace,destination}=f;assert.ok(Buffer.byteLength(JSON.stringify(record))>2*1024*1024);
 const prior=await workspace.outline(),original=ResearchCatalogue.prototype.record;
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Notebook move reconstructed an entire record');});
 const retain=RecordQueryDocuments.prototype.retainDocument;let reused=0;
 t.mock.method(RecordQueryDocuments.prototype,'retainDocument',async function(document,revision,options){
  if((await document.field(['id'])).value!==record.id)return retain.call(this,document,revision,options);
  assert.equal(options.previous.id,record.id);reused++;const items=document.items;document.items=async function*(){throw Error('Same-notebook privacy change rebuilt unchanged query collections');};
  try{return await retain.call(this,document,revision,options);}finally{document.items=items;}
 });
 const relocated=await f.service.execute('notebook',{etag:prior.etag,response:'outline',change:{id:book.notebooks[0].id,title:'Relocated book',projectId:book.projects[1].id}});
 RecordQueryDocuments.prototype.retainDocument.mock.restore();assert.equal(reused,1);
 assert.equal(relocated.moved,true);assert.equal(relocated.total,book.entries.length);
 const command=move(f,relocated.etag),moved=await f.service.execute('structure',command);
 assert.deepEqual(await f.service.execute('structure',command),moved);assert.equal(moved.notebookCounts[destination.id],book.entries.length);
 assert.equal(moved.book.notebooks.some(n=>n.id===book.notebooks[0].id),false);
 await workspace.catalogue(async store=>{
  const current=await store.snapshot(),row=await store.member(current,record.id),old=await store.member(await store.snapshot(prior.etag),record.id);
  assert.equal(row.notebookId,destination.id);assert.equal(row.share,false);
  await withRecordDocument(store,row.id,row.revision,async document=>{
   assert.equal(document.blocks.scopeId,destination.id);assert.equal((await document.field(['body'])).value,record.body);
   assert.equal(await document.tree.arrayLength(document.root,['sections']),record.sections.length);
   for(let i=0;i<record.sections.length;i++)assert.deepEqual((await document.field(['sections',String(i)])).value,record.sections[i]);
  });
  await withRecordDocument(store,old.id,old.revision,async document=>{assert.equal(document.blocks.scopeId,book.notebooks[0].id);assert.equal((await document.field(['share'])).value,true);});
 });
 const values=new RecordValues(workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},currentTitle=await values.read(target);
 await values.save({...target,expectedRevision:currentTitle.revision,value:{value:'Authoring after the move'}});
 const history=new RecordHistory(workspace,{}),versions=await history.list({workspaceId:book.id,recordId:record.id});assert.equal(versions.versions.length,5);
 // Other, small historical records may use their original compatibility reader.
 ResearchCatalogue.prototype.record.mock.restore();
 t.mock.method(ResearchCatalogue.prototype,'record',function(id,...args){if(id===record.id)throw Error('Recovery reconstructed the heavy record');return original.call(this,id,...args);});
 const access=await createAccess('','synthetic moved-record recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const copied=await encryptedCopy(await copyPlan(workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),recovered=new Workspace(copied,vault);
 await recovered.catalogue(store=>store.verify(catalogueDescriptor(book)));
 assert.equal((await new RecordValues(recovered).read(target)).value.value,'Authoring after the move');
 assert.deepEqual(await new StructureCommands(recovered).execute('structure',command),moved);
 const retained=await new RecordWriting(recovered).read({workspaceId:book.id,recordId:record.id,sectionId:record.sections.at(-1).id});assert.equal(retained.value.body,record.sections.at(-1).body);
});

test('interruption while copying notebook-keyed blocks and a failed final commit leave no moved records or receipts',async t=>{
 const f=await setup(t),before=await f.workspace.outline(),command=move(f,before.etag);
 const inventory=()=>f.workspace.catalogue(async store=>({records:await store.db.all('SELECT id,revision,scope_id FROM records ORDER BY id,revision'),state:await store.db.all('SELECT slot,payload FROM state ORDER BY slot'),snapshots:await store.db.all('SELECT id FROM snapshots ORDER BY ordinal'),keys:await store.db.all('SELECT scope_id,generation FROM scope_keys ORDER BY scope_id,generation')}));
 const saved=await inventory(),controller=new AbortController(),put=RecordBlockStore.prototype.put;let writes=0;
 t.mock.method(RecordBlockStore.prototype,'put',async function(...args){const result=await put.apply(this,args);if(this.scopeId===f.destination.id&&++writes===4)controller.abort();return result;});
 await assert.rejects(f.service.execute('structure',command,{signal:controller.signal}),{name:'AbortError'});assert.ok(writes>=4);RecordBlockStore.prototype.put.mock.restore();
 assert.equal((await f.workspace.outline()).etag,before.etag);assert.deepEqual(await inventory(),saved);
 const finish=ResearchCatalogue.prototype.finishRecordChanges;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted final hierarchy commit');});
 await assert.rejects(f.service.execute('structure',command),/Interrupted final hierarchy commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();
 assert.equal((await f.workspace.outline()).etag,before.etag);assert.deepEqual(await inventory(),saved);
 const moved=await f.service.execute('structure',command);assert.equal(moved.notebookCounts[f.destination.id],f.book.entries.length);assert.deepEqual(await f.service.execute('structure',command),moved);
});
