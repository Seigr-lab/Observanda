import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtemp,mkdir,copyFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {Workspace,workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {backupCatalogue,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {rekeyCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {WebsiteDocumentStore} from '../src/website-document-store.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {websiteDocumentLocks} from '../src/website-document-registry.js';
import {websiteDocument} from '../src/web/website-sites-model.js';
const detached=AsyncLocalStorage.snapshot();
function gate(){let enter,release;return {started:new Promise(resolve=>enter=resolve),hold:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};}
function named(metadata,name){return {id:randomUUID(),name,projectId:null,document:websiteDocument(metadata),projects:metadata.projects.map(({id,share,logoId})=>({id,share,logoId:logoId??null})),selection:{defaultShare:false,includeProjects:[],records:[]}};}
async function write(workspace,ids,operation,{registration=false}={}){
 const db=await workspace.openCatalogue();try{await db.run('BEGIN');const store=workspace.catalogueStore(db);await websiteDocumentLocks(store,{websiteIds:ids,registration});const result=await db.scope(()=>operation(new WebsiteDocumentStore(store),store));await db.run('COMMIT');return result;}finally{await db.close();}
}
async function read(workspace,id,options){return workspace.catalogue(store=>new WebsiteDocumentStore(store).read(id,options));}
async function fixture(t){
 const temporary=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(temporary,'observanda-website-storage-')),book=upgradeNotebook(sampleNotebook()),vaults=[];
 book.entries=[{...book.entries[0],attachments:[],figures:[],relations:[],sections:[]}];
 t.after(async()=>{for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),temporary);assert.ok(path.basename(directory).startsWith('observanda-website-storage-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const value=await encryptedFixture(directory,book);vaults.push(value.vault);return {...value,directory,book,vaults};
}

test('independent website writers preserve research progress and reconcile consent atomically', {timeout:120000},async t=>{
 const f=await fixture(t),{workspace}=f,original=await workspace.read(),record=original.book.entries[0];
 const root=await read(workspace,null);assert.equal(root.websiteId,null);assert.equal(root.site.selection.defaultShare,false);assert.equal(await workspace.catalogue(async store=>(await store.snapshot()).websiteDocuments),1);
 const a=named(original.book,'First independent site'),b=named(original.book,'Second independent site');
 a.selection.records=[{id:record.id,share:true,attachments:[]}];
 await write(workspace,[],async(documents,store)=>{const researchSnapshotId=await store.head();await documents.create(a,{researchSnapshotId});await documents.create(b,{researchSnapshotId});},{registration:true});
 const first=await read(workspace,a.id),second=await read(workspace,b.id),research=gate();
 const heldResearch=detached(()=>workspace.withLock(async()=>{research.enter();await research.hold;}));await Promise.race([research.started,heldResearch]);
 try{const next={...first.site,name:'Site write beside research writer'};await write(workspace,[a.id],(documents,store)=>documents.save(a.id,next,{researchSnapshotId:first.researchSnapshotId,expectedRevision:first.websiteRevision}));assert.equal((await workspace.outline()).etag,original.etag);}finally{research.release();await heldResearch;}
 const current=await read(workspace,a.id),site=gate(),pending=detached(()=>write(workspace,[a.id],async(documents,store)=>{
  await documents.save(a.id,{...current.site,name:'First writer committed'}, {researchSnapshotId:await store.head(),expectedRevision:current.websiteRevision});site.enter();await site.hold;
 }));await Promise.race([site.started,pending]);
 let changed;
 try{
  await write(workspace,[b.id],(documents,store)=>documents.save(b.id,{...second.site,name:'Second writer committed'},{researchSnapshotId:second.researchSnapshotId,expectedRevision:second.websiteRevision}));
  await assert.rejects(write(workspace,[a.id],()=>assert.fail('Same site lock was bypassed')),{code:'LOCKED'});
  changed={...record,title:'Research authoring beside an independent site writer'};
  await new ResearchRecords(workspace,{}).save({workspaceId:original.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:changed}]},{compact:true});
  changed=(await workspace.read()).book.entries[0];const researchHead=(await workspace.outline()).etag;
  await assert.rejects(new ResearchRecords(workspace,{}).remove({workspaceId:original.book.id,recordId:record.id,expectedRevision:recordRevision(changed)}),{code:'LOCKED'});
  assert.equal((await workspace.outline()).etag,researchHead);assert.equal((await workspace.read()).book.entries.length,1);assert.equal((await read(workspace,a.id)).websiteRevision,current.websiteRevision);
 }finally{site.release();await pending;}
 const retained=await read(workspace,a.id);await new ResearchRecords(workspace,{}).remove({workspaceId:original.book.id,recordId:record.id,expectedRevision:recordRevision(changed)});
 assert.equal((await workspace.read()).book.entries.length,0);assert.deepEqual((await read(workspace,a.id)).site.selection.records,[]);assert.deepEqual((await read(workspace,a.id,retained)).site.selection.records,[{id:record.id,share:true,attachments:[]}]);
 await workspace.catalogue(async store=>{assert.equal((await store.snapshot()).websiteDocuments,1);await new WebsiteDocumentStore(store).verify();});
});

test('independent website current and retained documents survive archive activation and fresh-key rekey', {timeout:180000},async t=>{
 const f=await fixture(t),{workspace}=f,initial=await workspace.read(),a=named(initial.book,'Portable independent website');
 const created=await write(workspace,[],async(documents,store)=>documents.create(a,{researchSnapshotId:await store.head()}),{registration:true});
 await write(workspace,[a.id],async(documents,store)=>documents.save(a.id,{...a,name:'Retained and current design',document:{...a.document,website:{...a.document.website,footer:'Exact retained website bytes'}}},{researchSnapshotId:await store.head(),expectedRevision:created.websiteRevision}));
 const expected=await read(workspace,a.id),original=await read(workspace,a.id,created),defaultOwner=await read(workspace,null),descriptor=await workspace.readFile(await workspaceFile(workspace.root),'utf8');
 const editor=new WebsiteEditor(workspace),opened=await editor.execute('open',{workspaceId:initial.book.id,websiteId:a.id}),draft=await editor.execute('change',{workspaceId:initial.book.id,websiteId:a.id,websitePin:opened.websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'settings',path:['document','website','footer'],value:'Unfinished portable website draft'}]});
 await verifyCatalogueArchive(workspace,JSON.parse(descriptor));
 const copyRoot=path.join(f.directory,'archive-copy');await mkdir(path.join(copyRoot,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(workspace.root)),'.observanda/access.json'])await copyFile(path.join(workspace.root,file),path.join(copyRoot,file));
 const db=await workspace.openCatalogue();try{await backupCatalogue(workspace.root,copyRoot,{connection:db});}finally{await db.close();}
 const header=JSON.parse((await readFile(path.join(copyRoot,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);assert.equal(header.version,11);assert.ok([38,39,40,41,42,43].includes(header.catalogueVersion));
 const copied=new Workspace(copyRoot,f.vault);assert.deepEqual(await copied.read(),initial);await verifyCatalogueArchive(copied,JSON.parse(descriptor));assert.notEqual((await catalogueBinding(copied.root)).id,(await catalogueBinding(workspace.root)).id);
 assert.deepEqual(await read(copied,a.id),expected);assert.deepEqual(await read(copied,a.id,created),original);assert.deepEqual(await read(copied,null),defaultOwner);
 assert.deepEqual((await new WebsiteEditor(copied).execute('open',{workspaceId:initial.book.id,websiteId:a.id})).draft,draft.draft);
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.directory,'fresh-device')})),vault=takeCreatedVault(access);f.vaults.push(vault);
 const target=new Workspace(path.join(f.directory,'rekeyed'),vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);
 await rekeyCatalogue(workspace,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));assert.deepEqual(await target.read(),initial);assert.deepEqual(await read(target,a.id),expected);assert.deepEqual(await read(target,a.id,created),original);assert.deepEqual(await read(target,null),defaultOwner);
 const targetEditor=new WebsiteEditor(target),targetDraft=await targetEditor.execute('open',{workspaceId:initial.book.id,websiteId:a.id});assert.deepEqual(targetDraft.draft,draft.draft);
 await targetEditor.execute('save',{workspaceId:initial.book.id,websiteId:a.id,draftId:targetDraft.draft.id,expectedRevision:targetDraft.draft.revision,commandId:randomUUID()});
 assert.equal((await read(target,a.id)).site.document.website.footer,'Unfinished portable website draft');assert.deepEqual(await read(workspace,a.id),expected);assert.deepEqual((await editor.execute('open',{workspaceId:initial.book.id,websiteId:a.id})).draft,draft.draft);
 await copied.withLock(()=>copied.catalogue(async store=>{await store.db.run("DELETE FROM state WHERE slot=$1",'website-document:head:'+a.id);}));
 await assert.rejects(verifyCatalogueArchive(copied,JSON.parse(descriptor)),{code:'CATALOGUE_DAMAGED'});await verifyCatalogueArchive(workspace,JSON.parse(descriptor));
});
