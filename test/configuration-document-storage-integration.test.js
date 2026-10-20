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
import {ConfigurationDocuments} from '../src/configuration-documents.js';
import {catalogueFormat,catalogueRequiresConfigurationDocuments,catalogueRequiresNestedAttemptCollections,requireNestedAttemptCollections} from '../src/catalogue-format.js';
import {rekeyCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {backupCatalogue,transferCatalogue,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {readRecordOwnerHistory} from '../src/record-owner-history.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
const media={get:async()=>{throw Error('Unexpected synthetic media');}};
const format=workspace=>workspace.catalogue(store=>catalogueFormat(store.db));
const blockCount=workspace=>workspace.catalogue(async store=>Number((await store.db.get("SELECT COUNT(*)::text AS n FROM state WHERE starts_with(slot,'configuration-block:')")).n));
const schema=(sectionId,label,count)=>({profiles:[{id:'synthetic',version:1,enabled:true}],sections:[{id:sectionId,profileId:'synthetic',key:'observations',label,description:'Portable schema',enabled:true,fields:[{key:'condition',label:'Condition',type:'select',unit:'',required:false,choices:Array.from({length:count},(_,i)=>'Choice '+i)}]}]});
const ownerFor=(metadata,notebook)=>({workspaceId:metadata.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'});
async function configure(workspace,notebookId,value){
 return workspace.withLock(()=>workspace.catalogue(async store=>{
  const head=await store.head(),current=await store.indexed(await store.snapshot(head)),metadata=structuredClone(current.metadata),notebook=metadata.notebooks.find(value=>value.id===notebookId),project=metadata.projects.find(value=>value.id===notebook.projectId),documents=new ConfigurationDocuments(store);
  notebook.configuration=await documents.retainInline(ownerFor(metadata,notebook),value);
  project.labBookTemplate={name:'Retained project template',configuration:await documents.retainInline({workspaceId:metadata.id,projectId:project.id,notebookId:null,slot:'labBookTemplate'},value)};
  await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);
  return {notebook:notebook.configuration,template:project.labBookTemplate.configuration,snapshotId:await store.head()};
 }));
}
async function reviseConfiguration(workspace,notebookId,sectionId){
 return workspace.withLock(()=>workspace.catalogue(async store=>{
  const head=await store.head(),current=await store.indexed(await store.snapshot(head)),metadata=structuredClone(current.metadata),notebook=metadata.notebooks.find(value=>value.id===notebookId),project=metadata.projects.find(value=>value.id===notebook.projectId),documents=new ConfigurationDocuments(store);
  const operations=[{type:'replace',collection:'sections',key:sectionId,value:{label:'Later schema'}},{type:'append',collection:'choices',sectionId,fieldKey:'condition',value:'Choice 33'}];
  notebook.configuration=await documents.applySelected(await documents.open(ownerFor(metadata,notebook),notebook.configuration),operations,{draft:false});
  project.labBookTemplate.configuration=await documents.applySelected(await documents.open({workspaceId:metadata.id,projectId:project.id,notebookId:null,slot:'labBookTemplate'},project.labBookTemplate.configuration),operations,{draft:false});
  await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);return {notebook:notebook.configuration,template:project.labBookTemplate.configuration,snapshotId:await store.head()};
 }));
}
async function saveRecord(workspace,workspaceId,recordId,title){
 const record=await workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),recordId);return store.record(recordId,row.revision);});
 await new ResearchRecords(workspace,media).save({workspaceId,changes:[{id:recordId,expectedRevision:recordRevision(record),record:{...record,title}}]},{receipt:true});
 return workspace.catalogue(store=>store.head());
}

test('configuration references retain historical owners through cancellation, transfer, archive and fresh-key recovery',{timeout:240000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-configuration-compatibility-')),book=upgradeNotebook(sampleNotebook());
 book.entries=[{...book.entries[0],body:'Exact portable observation',share:false,attachments:[],figures:[],relations:[],sections:[]}];
 const notebookId=book.entries[0].notebookId,recordId=book.entries[0].id,sourceFixture=await encryptedFixture(path.join(directory,'source'),book),targetBook={...structuredClone(book),id:randomUUID(),entries:[]},targetFixture=await encryptedFixture(path.join(directory,'target'),targetBook),source=sourceFixture.workspace,target=targetFixture.workspace,vaults=[sourceFixture.vault,targetFixture.vault];
 t.after(async()=>{vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-configuration-compatibility-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const legacySnapshot=await source.catalogue(store=>store.head()),before=await format(source),failure=Error('Deliberate configuration rollback'),sectionId=randomUUID();
 await assert.rejects(source.withLock(()=>source.catalogue(async store=>{
  const metadata=(await store.snapshot()).metadata,notebook=metadata.notebooks.find(value=>value.id===notebookId);await new ConfigurationDocuments(store).retainInline(ownerFor(metadata,notebook),schema(sectionId,'Rolled back',1));await requireNestedAttemptCollections(store.db);throw failure;
 })),error=>error===failure);
 assert.equal(await format(source),before);assert.equal(await blockCount(source),0);
 const first=await configure(source,notebookId,schema(sectionId,'Earlier schema',33));first.recordSnapshot=await saveRecord(source,book.id,recordId,'Observation under earlier schema');
 const second=await reviseConfiguration(source,notebookId,sectionId);second.recordSnapshot=await saveRecord(source,book.id,recordId,'Observation under later schema');
 assert.notEqual(first.notebook.root,second.notebook.root);assert.equal(catalogueRequiresConfigurationDocuments(await format(source)),true);
 await source.catalogue(async store=>{
  assert.equal((await store.snapshot(legacySnapshot)).metadata.notebooks.find(value=>value.id===notebookId).configuration?.format,undefined);
  const documents=new ConfigurationDocuments(store),reader=await documents.open(first.notebook.owner,first.notebook),page=await reader.window({collection:'choices',sectionId,fieldKey:'condition',offset:31,limit:2});
  assert.equal(page.total,33);assert.deepEqual(page.rows.map(row=>row.value),['Choice 31','Choice 32']);assert.equal(page.next,null);
  await assert.rejects(documents.open({...first.notebook.owner,workspaceId:targetBook.id},first.notebook),{code:'CATALOGUE_DAMAGED'});
 });
 const targetConfig=await configure(target,notebookId,schema(randomUUID(),'Destination schema',2)),retainedBlocks=await blockCount(target),sourceOwner={workspaceId:book.id,projectId:null,labBookId:null},targetOwner={workspaceId:targetBook.id,projectId:null,labBookId:null},engine=new RecordOwnerTransfer(source,target,{registry:{workspace:source},sourceOwner,targetOwner});
 const current=await source.catalogue(async store=>store.member(await store.snapshot(),recordId)),command={id:randomUUID(),workspaceId:book.id,recordId,sourceNotebookId:notebookId,expectedStorageRevision:current.revision,targetWorkspaceId:targetBook.id,targetNotebookId:notebookId},request=id=>({workspaceId:book.id,recordId,id});
 let copiedConfiguration=false;
 await assert.rejects(engine.start(command,{checkpoint:async stage=>{if(stage==='history'&&await blockCount(target)>retainedBlocks){copiedConfiguration=true;throw Error('Pause after configuration copy');}}}),/Pause after configuration copy/);
 assert.equal(copiedConfiguration,true);assert.equal((await engine.cancel(request(command.id))).progress.reclamation.state,'complete');assert.equal(await blockCount(target),retainedBlocks);
 const moved=await engine.start({...command,id:randomUUID()});assert.equal(moved.phase,'complete');
 await target.withLock(()=>target.catalogue(store=>requireNestedAttemptCollections(store.db)));
 const generation=await format(target),descriptorText=await target.readFile(await workspaceFile(target.root),'utf8'),descriptor=JSON.parse(descriptorText),expectedPointers=new Map([[first.recordSnapshot,first],[second.recordSnapshot,second]]);
 async function check(workspace){
  assert.equal(await format(workspace),generation);assert.equal(catalogueRequiresNestedAttemptCollections(generation),true);
  await workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(),notebook=snapshot.metadata.notebooks.find(value=>value.id===notebookId);assert.deepEqual(notebook.configuration,targetConfig.notebook);
   const documents=new ConfigurationDocuments(store),selected=await documents.open(ownerFor(snapshot.metadata,notebook),notebook.configuration);assert.equal((await selected.window({collection:'choices',sectionId:(await selected.window({collection:'sections'})).rows[0].key,fieldKey:'condition'})).total,2);
   let found=0;
   for await(const key of store.objectIdEntries('record-owner-history:')){
    const value=await store.object(key),retained=await readRecordOwnerHistory(store,key.slice('record-owner-history:'.length),recordId,{verifyConfigurations:true}),expected=expectedPointers.get(value.sourceSnapshotId);if(!expected)continue;found++;
    const oldBook=retained.metadata.notebooks[0],oldProject=retained.metadata.projects[0];
    for(const [pointer,original] of [[oldBook.configuration,expected.notebook],[oldProject.labBookTemplate.configuration,expected.template]]){assert.equal(pointer.owner.workspaceId,targetBook.id);assert.equal(pointer.root,original.root);assert.deepEqual(pointer.index,original.index);}
    const reader=await documents.open(ownerFor(retained.metadata,oldBook),oldBook.configuration),section=await reader.item({collection:'sections',key:sectionId});assert.equal(section.value.label,expected===first?'Earlier schema':'Later schema');
   }
   assert.equal(found,2);
  });
  await verifyCatalogueArchive(workspace,descriptor);
 }
 await check(target);
 // A damaged retained root is refused without changing any live source bytes.
 await target.withLock(()=>target.catalogue(async store=>{
  const slot='configuration-block:value:'+first.notebook.root,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,{type:'inline',value:'Damaged retained root'}),slot);
  try{await assert.rejects(new ConfigurationDocuments(store).verify({...first.notebook.owner,workspaceId:targetBook.id},{...first.notebook,owner:{...first.notebook.owner,workspaceId:targetBook.id}}),{code:'CATALOGUE_DAMAGED'});}finally{await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',row.payload,slot);}
 }));
 async function archive(name){
  const root=path.join(directory,name);await mkdir(path.join(root,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(target.root)),'.observanda/access.json'])await copyFile(path.join(target.root,file),path.join(root,file));
  const db=await target.openCatalogue();try{await backupCatalogue(target.root,root,{connection:db});}finally{await db.close();}
  const header=JSON.parse((await readFile(path.join(root,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);assert.equal(header.version,15);assert.equal(header.catalogueVersion,generation);return new Workspace(root,targetFixture.vault);
 }
 const ordinary=await archive('ordinary-archive');await check(ordinary);assert.notEqual((await catalogueBinding(ordinary.root)).id,(await catalogueBinding(target.root)).id);
 const directRoot=path.join(directory,'ordinary-direct');await mkdir(path.join(directRoot,'.observanda'),{recursive:true});await copyFile(path.join(target.root,'.observanda/access.json'),path.join(directRoot,'.observanda/access.json'));const direct=new Workspace(directRoot,targetFixture.vault);await direct.writeFile(await workspaceFile(directRoot,{secure:true}),descriptorText);
 const from=await target.openCatalogue(),to=await direct.openCatalogue({create:true,detached:true});try{await to.run('BEGIN');await transferCatalogue(from,to);await to.scope(()=>direct.catalogueStore(to).verify(descriptor));await to.run('COMMIT');await backupCatalogue(direct.root,direct.root,{connection:to});}finally{await from.close();await to.close();}await check(direct);
 async function rekey(sourceOwner,name){
  const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(directory,name+'-device')})),vault=takeCreatedVault(access);vaults.push(vault);assert.notEqual(vault.id,targetFixture.vault.id);const destination=new Workspace(path.join(directory,name),vault);
  await mkdir(path.join(destination.root,'.observanda'),{recursive:true});await atomicWrite(path.join(destination.root,'.observanda/access.json'),serialize(access));await destination.writeFile(await workspaceFile(destination.root,{secure:true}),descriptorText);await rekeyCatalogue(sourceOwner,destination,descriptor);await check(destination);
 }
 await rekey(target,'fresh-live');const archived=await archive('archive-before-rekey');assert.equal(await catalogueBinding(archived.root),null);await rekey(archived,'fresh-archive');
 t.diagnostic('Current and historical configuration refs, owner rebinding and cancellation cleanup survived ordinary/direct and fresh-key/archive recovery.');
});
