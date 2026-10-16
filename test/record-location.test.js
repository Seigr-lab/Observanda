import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordLocation} from '../src/record-location.js';
import {RecordContent} from '../src/record-content.js';
import {RecordValues} from '../src/record-values.js';
import {StructureCommands} from '../src/structure-commands.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {withRecordDocument} from '../src/record-document.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {publicationSource} from '../src/publication-source.js';

async function fixture(t,large=false){
 const f=await figureValueFixture({large});t.after(f.close);
 const notebook={...f.book.notebooks[0],id:randomUUID(),title:'Destination'};
 await new StructureCommands(f.workspace).execute('structure',{etag:(await f.workspace.outline()).etag,response:'outline',change:{kind:'notebook',value:notebook}});
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
 const root=await encryptedCopy(await copyPlan(workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),recovered=new Workspace(root,vault);
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

test('moving between projects removes old website membership and overrides destination-wide publication defaults',async t=>{
 const f=await fixture(t),project={...f.book.projects[0],id:randomUUID(),title:'Other project',parentId:null};
 await f.workspace.update(book=>{book.projects.push(project);book.notebooks.find(n=>n.id===f.notebook.id).projectId=project.id;return book;});
 const sites=new WebsiteSites(f.workspace),ids=[];
 for(const projectId of [f.book.projects[0].id,project.id]){
  const created=await sites.change({workspaceId:f.book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Site '+ids.length});ids.push(created.id);
  const current=await sites.read(created.id);await sites.save(created.id,{workspaceId:f.book.id,baseEtag:current.etag,metadata:{},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[projectId],records:[]}});
 }
 const before=(await f.workspace.outline()).etag,source=websiteWorkspace(f.workspace,ids[0]),destination=websiteWorkspace(f.workspace,ids[1]);
 const retained=await f.workspace.catalogue(store=>store.snapshot(before));
 assert.deepEqual((await publicationSource(source,{etag:before})).entries.map(r=>r.id),[f.record.id]);
 await f.moves.move(f.command);const after=(await f.workspace.outline()).etag;
 assert.deepEqual((await publicationSource(source,{etag:after})).entries,[]);assert.deepEqual((await publicationSource(destination,{etag:after})).entries,[]);
 const target=await sites.read(ids[1]);assert.deepEqual(target.site.selection.records,[{id:f.record.id,share:false,attachments:[]}]);
 await f.workspace.catalogue(async store=>{const old=await store.snapshot(before);assert.deepEqual(old,retained);assert.equal((await store.member(old,f.record.id)).notebookId,f.command.sourceNotebookId);});
});
