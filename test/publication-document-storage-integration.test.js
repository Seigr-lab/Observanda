import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,copyFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {Workspace,workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {catalogueContext,rekeyCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {catalogueFormat,catalogueRequiresPublicationDocuments,catalogueRequiresDomains,catalogueRequiresSettings,catalogueRequiresWebsites,catalogueRequiresWebsiteEditor,catalogueRequiresWebsitePresentation,catalogueRequiresStagedEvidence,requireStagedEvidence} from '../src/catalogue-format.js';
import {assertPublicationDocumentStorage} from '../src/publication-document-storage.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {backupCatalogue,transferCatalogue,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {catalogueBinding} from '../src/postgres-activation.js';

const capabilities=value=>[catalogueRequiresDomains,catalogueRequiresSettings,catalogueRequiresWebsites,catalogueRequiresWebsiteEditor,catalogueRequiresWebsitePresentation,catalogueRequiresStagedEvidence].map(check=>check(value));
const format=workspace=>workspace.catalogue(store=>catalogueFormat(store.db));
async function fixture(t){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-publication-compatibility-')),book=upgradeNotebook(sampleNotebook());
 book.entries=[{...book.entries[0],share:true,body:'Exact portable research original',attachments:[],figures:[],relations:[],sections:[]}];
 const value=await encryptedFixture(directory,book),vaults=[value.vault];
 t.after(async()=>{vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-publication-compatibility-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...value,directory,book,vaults};
}

test('native publication capability admission rolls back with its writer and rejects a foreign owner',{timeout:90000},async t=>{
 const {workspace,vault}=await fixture(t),before=await format(workspace),receipt='.observanda/publication-admission-proof.json',failure=Error('Deliberate transaction rollback');assert.equal(catalogueRequiresPublicationDocuments(before),false);
 await assert.rejects(workspace.withLock(async()=>{await assertPublicationDocumentStorage(workspace);assert.equal(catalogueRequiresPublicationDocuments(await format(workspace)),true);await workspace.writeMetadata(receipt,'{}');throw failure;}),error=>error===failure);
 assert.equal(await format(workspace),before);assert.equal(await workspace.readMetadata(receipt,64),null);
 await workspace.withLock(async()=>{
  const held=catalogueContext.getStore();
  for(const context of [{...held,projectId:randomUUID()},{...held,labBookId:randomUUID()}])await assert.rejects(catalogueContext.run(context,()=>assertPublicationDocumentStorage(workspace)),{code:'DATABASE_LOCATION'});
  const other={id:randomUUID(),key:Buffer.from(vault.key)};
  try{await assert.rejects(catalogueContext.run({...held,vault:other},()=>assertPublicationDocumentStorage(workspace)),{code:'ACCESS_DENIED'});}finally{other.key.fill(0);}
  const controller=new AbortController();controller.abort();await assert.rejects(assertPublicationDocumentStorage(workspace,{signal:controller.signal}),{name:'AbortError'});assert.equal(await format(workspace),before);
  await assertPublicationDocumentStorage(workspace);await workspace.writeMetadata(receipt,'{}');
 });
 assert.equal(catalogueRequiresPublicationDocuments(await format(workspace)),true);assert.deepEqual(capabilities(await format(workspace)),capabilities(before));assert.equal(await workspace.readMetadata(receipt,64),'{}');
});

test('native publication owners survive ordinary archive and direct transfer plus fresh-key live and archive recovery',{timeout:240000},async t=>{
 const f=await fixture(t),{workspace}=f,editor=new WebsiteEditor(workspace),opened=await editor.execute('open',{workspaceId:f.book.id,websiteId:null}),page={id:randomUUID(),title:'Portable retained page',share:true,body:'Exact retained custom-page original',sections:[]};
 const draft=await editor.execute('change',{workspaceId:f.book.id,websiteId:null,websitePin:opened.websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'settings',path:['selection'],value:{defaultShare:false,includeProjects:f.book.projects.map(project=>project.id),records:[]}},{type:'append',collection:'pages',values:[page]},{type:'replace',collection:'layouts',key:'page:'+page.id,value:{target:'page:'+page.id,showHeading:true,heading:'Exact retained page heading',description:'',placement:'before',sections:[]}},{type:'replace',collection:'branding',key:'page:'+page.id,value:{target:'page:'+page.id,logos:[]}}]});
 await workspace.withLock(()=>workspace.catalogue(store=>requireStagedEvidence(store.db)));const prior=await format(workspace),publication=websiteWorkspace(workspace,null),releases=new PublicationJobs(publication);
 const source=await withPublicationCapture(publication,async(captured,id,finish)=>{const pinned=await releases.pin({etag:draft.websitePin.researchSnapshotId,websitePin:draft.websitePin,websiteDraft:{id:draft.draft.id,revision:draft.draft.revision}},{workspace:captured,id});return finish(()=>pinned);});
 assert.equal(source.version,6);assert.equal(Object.hasOwn(source,'records'),false);const generation=await format(workspace);assert.equal(catalogueRequiresPublicationDocuments(generation),true);assert.deepEqual(capabilities(generation),capabilities(prior));assert.equal(catalogueRequiresWebsitePresentation(generation),true);assert.equal(catalogueRequiresStagedEvidence(generation),true);
 const descriptorText=await workspace.readFile(await workspaceFile(workspace.root),'utf8'),descriptor=JSON.parse(descriptorText),expected=await workspace.read();
 const check=async owner=>{
  assert.equal(await format(owner),generation);assert.deepEqual(await owner.read(),expected);const scoped=websiteWorkspace(owner,null),saved=await new PublicationJobs(scoped).source(source.id);assert.deepEqual(saved,source);
  const input=await openPublicationInput(scoped,saved);await input.verify();assert.equal(await input.recordCount(),1);assert.equal((await input.record(f.book.entries[0].id)).body,'Exact portable research original');assert.deepEqual(await input.page(page.id),page);assert.equal((await input.get('layouts','page:'+page.id)).heading,'Exact retained page heading');assert.deepEqual(await input.get('branding','page:'+page.id),{target:'page:'+page.id,logos:[]});
  assert.deepEqual((await new WebsiteEditor(owner).execute('open',{workspaceId:f.book.id,websiteId:null})).draft,draft.draft);await verifyCatalogueArchive(owner,descriptor);
 };
 await check(workspace);
 async function archive(name){
  const root=path.join(f.directory,name);await mkdir(path.join(root,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(workspace.root)),'.observanda/access.json'])await copyFile(path.join(workspace.root,file),path.join(root,file));
  const db=await workspace.openCatalogue();try{await backupCatalogue(workspace.root,root,{connection:db});}finally{await db.close();}
  const header=JSON.parse((await readFile(path.join(root,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);assert.equal(header.version,13);assert.equal(header.catalogueVersion,generation);return new Workspace(root,f.vault);
 }
 const copied=await archive('ordinary-archive');await check(copied);assert.notEqual((await catalogueBinding(copied.root)).id,(await catalogueBinding(workspace.root)).id);
 const directRoot=path.join(f.directory,'ordinary-direct');await mkdir(path.join(directRoot,'.observanda'),{recursive:true});await copyFile(path.join(workspace.root,'.observanda/access.json'),path.join(directRoot,'.observanda/access.json'));const direct=new Workspace(directRoot,f.vault);await direct.writeFile(await workspaceFile(directRoot,{secure:true}),descriptorText);
 const from=await workspace.openCatalogue(),to=await direct.openCatalogue({create:true,detached:true});try{await to.run('BEGIN');await transferCatalogue(from,to);await to.scope(()=>direct.catalogueStore(to).verify(descriptor));await to.run('COMMIT');await backupCatalogue(direct.root,direct.root,{connection:to});}finally{await from.close();await to.close();}await check(direct);
 async function rekey(sourceOwner,name){
  const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.directory,name+'-device')})),vault=takeCreatedVault(access);f.vaults.push(vault);assert.notEqual(vault.id,f.vault.id);
  const target=new Workspace(path.join(f.directory,name),vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptorText);
  await rekeyCatalogue(sourceOwner,target,descriptor);await check(target);return target;
 }
 await rekey(workspace,'fresh-live');const archiveOnly=await archive('archive-before-rekey');assert.equal(await catalogueBinding(archiveOnly.root),null);await rekey(archiveOnly,'fresh-archive');
 await check(workspace);t.diagnostic('Retained source document, selected originals, presentation indexes and unfinished draft survived four independent recovery paths with unchanged capabilities.');
});
