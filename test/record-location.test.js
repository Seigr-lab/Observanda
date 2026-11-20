import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordLocation} from '../src/record-location.js';
import {RecordContent} from '../src/record-content.js';
import {RecordValues} from '../src/record-values.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {withRecordDocument} from '../src/record-document.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,large=false){
 // The workspace starts with a second lab book in the same project to move the record into.
 const destination={id:randomUUID(),title:'Destination'},f=await figureValueFixture({large,extraNotebooks:[destination]});t.after(f.close);
 const notebook=f.book.notebooks.find(item=>item.id===destination.id);
 const reading=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true});
 const command={workspaceId:f.book.id,recordId:f.record.id,sourceNotebookId:f.record.notebookId,notebookId:notebook.id,expectedStorageRevision:reading.storageRevision,commandId:randomUUID()};
 return {...f,notebook,reading,command,moves:new RecordLocation(f.workspace)};
}

test('a selected record move preserves dense research, original scope history, exact retries and fresh-key recovery',async t=>{
 const f=await fixture(t,true),{workspace,record,command}=f;
 const before=await workspace.outline();
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Record move reconstructed an original');});
 const moved=await f.moves.move(command);assert.equal(moved.saved,true);assert.equal(moved.notebookId,f.notebook.id);
 assert.deepEqual(await f.moves.move(Object.fromEntries(Object.entries(command).reverse())),moved);
 const outline=await workspace.catalogue(store=>store.recordOutline());assert.equal(outline.notebookCounts[f.notebook.id],1);assert.equal(outline.notebookCounts[record.notebookId],0);
 await workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),record.id),old=await store.member(await store.snapshot(before.etag),record.id);
  assert.equal(old.revision,command.expectedStorageRevision);assert.equal(row.share,false);
  for(const [member,scope] of [[old,record.notebookId],[row,f.notebook.id]])await withRecordDocument(store,member.id,member.revision,async document=>{
   assert.equal(document.blocks.scopeId,scope);assert.equal((await document.field(['notebookId'])).value,scope);
   for(const name of ['body','figures','sections','results'])assert.deepEqual((await document.field([name])).value,record[name]);
  });
 });
 const values=new RecordValues(workspace),target={workspaceId:f.book.id,recordId:record.id,field:'title'},base=await values.read(target);
 await values.save({...target,expectedRevision:base.revision,value:{value:'Continued in the destination'}});
 assert.deepEqual(await f.moves.move(command),moved);assert.equal((await values.read(target)).value.value,'Continued in the destination');
 await assert.rejects(f.moves.move({...command,notebookId:randomUUID()}),{code:'CONFLICT'});
 const access=await createAccess('','synthetic location recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const root=await encryptedCopy(await copyPlan(workspace.root,path.join(f.directory,'recovered'),{vault:f.vault}),access,vault,f.vault),recovered=new Workspace(root,vault);
 await recovered.catalogue(store=>store.verify(catalogueDescriptor(f.book)));assert.deepEqual(await new RecordLocation(recovered).move(command),moved);
 const page=await new RecordContent(recovered).read({workspaceId:f.book.id,recordId:record.id,pagedHeader:true,offset:72});assert.deepEqual(page.sections.values[0],record.sections[72]);assert.equal(page.header.notebookId,f.notebook.id);
});

test('stale or invalid location commands cannot move records, and block/receipt interruption rolls back together',async t=>{
 const f=await fixture(t),{workspace,command}=f;
 const inventory=()=>workspace.catalogue(async store=>({head:await store.head(),records:await store.db.all('SELECT id,revision,scope_id FROM records ORDER BY id,revision'),keys:await store.db.all('SELECT scope_id,generation FROM scope_keys ORDER BY scope_id,generation'),snapshots:await store.db.all('SELECT id FROM snapshots ORDER BY ordinal')}));
 const before=await inventory();
 for(const bad of [{...command,extra:true},{...command,notebookId:command.sourceNotebookId},{...command,commandId:'invalid'}])await assert.rejects(f.moves.move(bad),{code:'INVALID'});
 await assert.rejects(f.moves.move({...command,expectedStorageRevision:'a'.repeat(64)}),{code:'RECORD_CHANGED'});
 await assert.rejects(f.moves.move({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.moves.move({...command,recordId:randomUUID()}),{code:'MISSING'});
 await assert.rejects(f.moves.move({...command,notebookId:randomUUID()}),{code:'MISSING'});
 const controller=new AbortController(),put=RecordBlockStore.prototype.put;let writes=0;
 t.mock.method(RecordBlockStore.prototype,'put',async function(...args){const result=await put.apply(this,args);if(this.scopeId===f.notebook.id&&++writes===4)controller.abort();return result;});
 await assert.rejects(f.moves.move(command,{signal:controller.signal}),{name:'AbortError'});assert.ok(writes>=4);RecordBlockStore.prototype.put.mock.restore();assert.deepEqual(await inventory(),before);
 const write=workspace.writeMetadata;t.mock.method(workspace,'writeMetadata',async function(file,...args){await write.call(this,file,...args);if(file.startsWith('.observanda/record-locations/'))throw Error('Interrupted move receipt');});
 await assert.rejects(f.moves.move(command),/Interrupted move receipt/);workspace.writeMetadata.mock.restore();assert.deepEqual(await inventory(),before);assert.equal(await workspace.readMetadata('.observanda/record-locations/'+command.commandId+'.json',8192),null);
 const saved=await f.moves.move(command);assert.deepEqual(await f.moves.move(command),saved);
 await workspace.withLock(()=>workspace.writeMetadata('.observanda/record-locations/'+command.commandId+'.json','{}'));await assert.rejects(f.moves.move(command),{code:'CATALOGUE_DAMAGED'});
});
