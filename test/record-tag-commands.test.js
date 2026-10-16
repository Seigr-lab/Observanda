import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordTagCommands} from '../src/record-tag-commands.js';
import {RecordContent} from '../src/record-content.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const target=f=>({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true});
async function command(f,action,position,tag){const page=await new RecordContent(f.workspace).read(target(f));return {workspaceId:f.book.id,recordId:f.record.id,id:randomUUID(),action,position,tag,expectedRevision:page.collections.tags.revision};}
const forbid=t=>t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Tag operation reconstructed a full record');});

test('tag changes page growing labels, preserve search/publication/history and guard stale positions and retries',async t=>{
 const tags=Array.from({length:257},(_,i)=>'capture-'+i),f=await figureValueFixture({tags});t.after(f.close);forbid(t);const service=new RecordTagCommands(f.workspace),reader=new RecordContent(f.workspace),before=(await f.workspace.outline()).etag;
 const field=RecordDocument.prototype.field;t.mock.method(RecordDocument.prototype,'field',function(path,...rest){if(path.length===1&&path[0]==='tags')throw Error('Tag edit assembled every label');return field.call(this,path,...rest);});
 const first=await reader.read(target(f)),last=await reader.read({...target(f),windows:{tags:253}});assert.equal(first.header.tags.length,4);assert.deepEqual(last.header.tags,tags.slice(253));assert.equal(last.collections.tags.total,257);
 const rename=await command(f,'rename',256,'reviewed-256'),stale=await command(f,'remove',0,null);await service.run(rename);await assert.rejects(service.run(stale),{code:'RECORD_CHANGED'});
 const add=await command(f,'add',null,'Later label'),receipt=await service.run(add);assert.equal(receipt.position,257);assert.deepEqual(await service.run(add),receipt);await assert.rejects(service.run({...add,tag:'Different request'}),{code:'RECORD_CHANGED'});
 const duplicate=await service.run(await command(f,'add',null,'Later label'));assert.equal(duplicate.position,257);await assert.rejects(service.run(await command(f,'rename',0,'Later label')),{code:'TAG_EXISTS'});
 const remove=await command(f,'remove',257,null);await service.run(remove);await service.run(await command(f,'add',null,'Replacement label'));await service.run(remove);const current=await reader.read({...target(f),windows:{tags:256}});assert.deepEqual(current.header.tags,['reviewed-256','Replacement label']);
 const old=await reader.read({...target(f),snapshotId:before,windows:{tags:256}});assert.deepEqual(old.header.tags,['capture-256']);
 const listing=await new RecordQuery(f.workspace).list({workspaceId:f.book.id,query:{projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse({tags:'reviewed-256'})}});assert.equal(listing.total,1);assert.equal(listing.records[0].id,f.record.id);
 await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id);for await(const result of store.queryDocuments([row],snapshot.metadata,{search:false,cards:true,publicationDetails:true})){assert.equal(result.tags.at(-1),'Replacement label');assert.equal(result.publicationCard.tags[256],'reviewed-256');assert.equal(result.publicationDescriptor.tags[256],'reviewed-256');}await store.verifySnapshot(undefined,f.book.id);});
});

test('tag commands and retry receipts recover with a new key on a heavy record',async t=>{
 const f=await figureValueFixture({large:true,tags:Array.from({length:33},(_,i)=>'review-'+i)});t.after(f.close);forbid(t);const service=new RecordTagCommands(f.workspace),remove=await command(f,'remove',32,null),receipt=await service.run(remove);await service.run(await command(f,'add',null,'Later replacement'));
 const access=await createAccess('','synthetic tag recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault);
 assert.deepEqual(await new RecordTagCommands(workspace).run(remove),receipt);const page=await new RecordContent(workspace).read({...target(f),windows:{tags:32}});assert.deepEqual(page.header.tags,['Later replacement']);
 await workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async doc=>{assert.deepEqual((await doc.field(['body'])).value,f.record.body);assert.deepEqual((await doc.field(['sections','72'])).value,f.record.sections[72]);});await store.verifySnapshot(undefined,f.book.id);});
});

test('a failed tag receipt rolls back the change, search projection and history together',async t=>{
 const f=await figureValueFixture();t.after(f.close);forbid(t);const service=new RecordTagCommands(f.workspace),add=await command(f,'add',null,'Interrupted tag'),etag=(await f.workspace.outline()).etag;
 const write=f.workspace.writeMetadata;t.mock.method(f.workspace,'writeMetadata',async function(file,...args){if(file.includes('/tag-commands/'))throw Error('Interrupted tag receipt');return write.call(this,file,...args);});
 await assert.rejects(service.run(add),/Interrupted tag receipt/);f.workspace.writeMetadata.mock.restore();assert.equal((await f.workspace.outline()).etag,etag);await service.run(add);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});
