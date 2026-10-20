import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ConfigurationDocuments} from '../src/configuration-documents.js';
import {ConfigurationCommands} from '../src/configuration-commands.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {readAccess,verifyAccess,createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {serialize,workspaceFile,atomicWrite} from '../src/storage.js';
import {catalogueDescriptor,rekeyCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {backupCatalogue} from '../src/postgres.js';
import {MAX_METADATA_BYTES} from '../src/web/research-capacity.js';

// Real current owners grow through registries and retained configuration roots;
// their parent research snapshots do not duplicate child metadata or content.
test('dedicated creation and larger referenced settings keep native headers bounded through startup and recovery',{timeout:240000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-native-headers-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),vaults=[];
 t.after(async()=>{await runtime.close();detach();for(const key of vaults)clearVault(key);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-native-headers-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'fixture'),createNotebook('Root','Parent details'));vaults.push(f.vault);const root=await f.workspace.outline(),registry=new ProjectRegistry(f.workspace,root.metadata.id),creation=new ProjectCreation(registry,f.deviceStore),projects=[];
 async function keyFor(root){const key=await verifyAccess(await readAccess(root),'','',{deviceStore:f.deviceStore});vaults.push(key);return key;}
 for(let i=0;i<2;i++){
  const project={id:randomUUID(),title:'Project '+i,description:'Separate child '+i,parentId:null,share:false,logoId:null},entry=(await creation.create({id:randomUUID(),project,username:'',password:''})).project;
  projects.push(new ProjectStorage(entry.root,entry.projectId,await keyFor(entry.root)));assert.deepEqual(await f.workspace.outline(),root);
 }
 const owner=projects[0],initial=await owner.outline(),books=[],bookCreation=new LabBookCreation(owner,f.deviceStore);
 for(let i=0;i<3;i++){
  const book={id:randomUUID(),projectId:owner.projectId,title:'Book '+i},entry=(await bookCreation.create({id:randomUUID(),book,username:'',password:''})).book;
  books.push(new LabBookStorage(entry.root,entry.labBookId,await keyFor(entry.root)));assert.deepEqual(await owner.outline(),initial);assert.deepEqual(await f.workspace.outline(),root);
 }
 const selected=books[0],before=await selected.outline(),schema={profiles:[],sections:Array.from({length:1000},(_,i)=>({id:randomUUID(),profileId:null,key:'type-'+i,label:'Type '+i,description:'x'.repeat(2000),enabled:true,fields:[]}))};assert.ok(Buffer.byteLength(serialize(schema))>MAX_METADATA_BYTES);
 const configOwner={workspaceId:before.metadata.id,projectId:owner.projectId,notebookId:selected.labBookId,slot:'configuration'};
 await selected.withLock(()=>selected.catalogue(async store=>{const current=await store.snapshot(),metadata=structuredClone(current.metadata);metadata.notebooks[0].configuration=await new ConfigurationDocuments(store).retainInline(configOwner,schema);await store.validateMetadata(current,metadata);await store.commitChanges(await store.head(),await store.indexed(current),metadata,[]);}));
 const configured=await selected.outline();assert.ok(Buffer.byteLength(serialize(configured.metadata))<16384);assert.deepEqual(await owner.outline(),initial);assert.deepEqual(await f.workspace.outline(),root);
 const commands=new ConfigurationCommands(selected),opened=await commands.open(configOwner),last=schema.sections.at(-1),draft=await commands.change({...configOwner,configurationPin:opened.configurationPin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'replace',collection:'sections',key:last.id,value:{label:'Exact last type after selected edit'}}]});
 await commands.save({...configOwner,configurationPin:opened.configurationPin,draftId:draft.draft.id,expectedRevision:draft.draft.revision,commandId:randomUUID()});
 const saved=await selected.outline(),descriptor=catalogueDescriptor(saved.metadata);assert.ok(Buffer.byteLength(serialize(saved.metadata))<16384);assert.equal(saved.metadata.projects.length,1);assert.equal(saved.metadata.notebooks.length,1);
 async function check(storage){
  const start=await new WorkspaceReader(storage).start();assert.deepEqual(start.metadata,{...saved.metadata,entries:[]});assert.ok(Buffer.byteLength(serialize(start))<20000);assert.equal(start.total,0);
  await storage.catalogue(async store=>{const docs=new ConfigurationDocuments(store),current=await store.snapshot(),reader=await docs.open(configOwner,current.metadata.notebooks[0].configuration),page=await reader.window({collection:'sections',offset:999,limit:1});assert.equal(page.total,1000);assert.equal(page.rows[0].value.label,'Exact last type after selected edit');assert.equal(page.next,null);
   const old=await store.snapshot(configured.etag),oldReader=await docs.open(configOwner,old.metadata.notebooks[0].configuration);assert.equal((await oldReader.item({collection:'sections',key:last.id})).value.label,last.label);assert.deepEqual((await store.snapshot(before.etag)).metadata,{...before.metadata,entries:[]});
  });await verifyCatalogueArchive(storage,descriptor);
 }
 await check(selected);await runtime.closeLabBook(selected.root);await check(new LabBookStorage(selected.root,selected.labBookId,selected.vault));
 const descriptorFile=path.basename(await workspaceFile(selected.root)),descriptorText=await selected.readFile(await workspaceFile(selected.root),'utf8'),archiveRoot=path.join(directory,'archive',path.basename(selected.root));await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});
 await copyFile(path.join(selected.root,'.observanda/access.json'),path.join(archiveRoot,'.observanda/access.json'));await copyFile(path.join(selected.root,descriptorFile),path.join(archiveRoot,descriptorFile));
 const db=await selected.openCatalogue();try{await backupCatalogue(selected.root,archiveRoot,{connection:db});}finally{await db.close();}await check(new LabBookStorage(archiveRoot,selected.labBookId,selected.vault));
 const freshRoot=path.join(directory,'rekey',path.basename(selected.root)),access=await createWorkspaceAccess('','',f.deviceStore),freshKey=takeCreatedVault(access);vaults.push(freshKey);const fresh=new LabBookStorage(freshRoot,selected.labBookId,freshKey);await mkdir(path.join(freshRoot,'.observanda'),{recursive:true});await atomicWrite(path.join(freshRoot,'.observanda/access.json'),serialize(access));await fresh.writeFile(await workspaceFile(freshRoot,{secure:true}),descriptorText);await rekeyCatalogue(selected,fresh,descriptor);await check(fresh);
 assert.deepEqual(await f.workspace.outline(),root);assert.deepEqual(await owner.outline(),initial);t.diagnostic(JSON.stringify({projects:2,books:3,configurationBytes:Buffer.byteLength(serialize(schema)),rootHeaderBytes:Buffer.byteLength(serialize(root.metadata)),projectHeaderBytes:Buffer.byteLength(serialize(initial.metadata)),bookHeaderBytes:Buffer.byteLength(serialize(saved.metadata)),archive:true,rekey:true}));
});
