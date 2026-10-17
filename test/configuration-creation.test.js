import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ConfigurationDocuments} from '../src/configuration-documents.js';
import {ConfigurationCommands} from '../src/configuration-commands.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {serialize} from '../src/storage-format.js';
import {validateNotebook} from '../src/model.js';
const schema=(id,label)=>({profiles:[],sections:[{id,profileId:null,key:'observations',label,description:'Exact configured source',enabled:true,fields:[{key:'condition',label:'Condition',type:'select',unit:'',required:false,choices:Array.from({length:97},(_,i)=>'Choice '+i)}]}]});
async function template(workspace,projectId,value){return workspace.withLock(()=>workspace.catalogue(async store=>{
 const head=await store.head(),current=await store.indexed(await store.snapshot(head)),metadata=structuredClone(current.metadata),owner={workspaceId:metadata.id,projectId,notebookId:null,slot:'labBookTemplate'};
 metadata.projects.find(value=>value.id===projectId).labBookTemplate={name:'Saved observation types',configuration:await new ConfigurationDocuments(store).retainInline(owner,value)};
 await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);return owner;
}));}

test('configured project and lab-book creation pin immutable schemas, recover attachment and consume only the exact draft',{timeout:180000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-configured-creation-')),databases=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(databases),fixture=await encryptedFixture(path.join(directory,'workspace'),sampleNotebook()),vaults=[fixture.vault],root=fixture.workspace;
 t.after(async()=>{await databases.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-configured-creation-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const metadata=(await root.outline()).metadata,sourceProject=metadata.projects[0].id,sectionId=randomUUID(),owner=await template(root,sourceProject,schema(sectionId,'Pinned source'));
 const pin=(await new ConfigurationCommands(root).open(owner)).configurationPin,registry=new ProjectRegistry(root,metadata.id),command={id:randomUUID(),project:{id:randomUUID(),title:'Configured project',description:'',parentId:null,share:false,logoId:null},username:'',password:'',configurationSource:pin};
 let sourceCalls=0;const creation=new ProjectCreation(registry,fixture.deviceStore,{withConfigurationSource:async(source,operation)=>{
  assert.deepEqual(source,pin);sourceCalls++;if(sourceCalls===2)await template(root,sourceProject,schema(sectionId,'Later source'));return operation(root);
 }}),attach=registry.attach.bind(registry);let interrupted=false;
 registry.attach=async(...args)=>{if(!interrupted){interrupted=true;throw Error('Pause before project attachment');}return attach(...args);};
 await assert.rejects(creation.create(command),/Pause before project attachment/);assert.equal(sourceCalls,2);assert.equal((await registry.read()).value.projects.length,0);
 const saved=await creation.read(command.id);validateNotebook(saved.intent.book);assert.equal(saved.intent.book.projects[0].labBookTemplate,undefined);assert.deepEqual(saved.intent.configuration.sourcePin,pin);assert.ok(Buffer.byteLength(serialize(saved.intent.configuration))<4096);
 const projectRoot=path.join(root.root,command.project.title),projectVault=await verifyAccess(await readAccess(projectRoot),'','',{deviceStore:fixture.deviceStore});vaults.push(projectVault);const project=new ProjectStorage(projectRoot,command.project.id,projectVault);
 const original=await project.catalogue(async store=>{const snapshot=await store.snapshot(),configuration=snapshot.metadata.projects[0].labBookTemplate.configuration,reader=await new ConfigurationDocuments(store).verify(configuration.owner,configuration),page=await reader.window({collection:'sections'});assert.equal(page.rows[0].value.label,'Pinned source');assert.notEqual(page.rows[0].key,sectionId);return configuration;});
 const unavailable=()=>{throw Error('Source should not be reopened after initialization');},resumed=await new ProjectCreation(registry,fixture.deviceStore,{withConfigurationSource:unavailable}).resume({id:command.id,username:'',password:''});assert.equal(resumed.project.projectId,command.project.id);
 assert.deepEqual(await new ProjectCreation(registry,fixture.deviceStore,{withConfigurationSource:unavailable}).create(command),resumed);
 assert.deepEqual(await project.catalogue(async store=>(await store.snapshot()).metadata.projects[0].labBookTemplate.configuration),original);
 const projectMetadata=(await project.outline()).metadata,bookId=randomUUID(),draftOwner={workspaceId:projectMetadata.id,projectId:command.project.id,notebookId:bookId,slot:'configuration'},commands=new ConfigurationCommands(project),draftSection=randomUUID();
 const draft=await commands.change({...draftOwner,create:true,commandId:randomUUID(),configurationPin:null,draftId:null,expectedRevision:null,operations:[{type:'append',collection:'sections',value:schema(draftSection,'Draft selected schema').sections[0]}]});
 const bookCommand={id:randomUUID(),book:{id:bookId,projectId:command.project.id,title:'Configured observations'},username:'',password:'',configurationDraft:{id:draft.draft.id,revision:draft.draft.revision},configurationPin:null},books=new LabBookCreation(project,fixture.deviceStore),bookAttach=books.registry.attach.bind(books.registry);let stop=true;
 books.registry.attach=async(...args)=>{if(stop){stop=false;throw Error('Pause before book attachment');}return bookAttach(...args);};
 await assert.rejects(books.create(bookCommand),/Pause before book attachment/);assert.equal((await commands.open({...draftOwner,create:true})).draft.revision,draft.draft.revision);
 const intent=await books.read(bookCommand.id);validateNotebook(intent.book);assert.equal(intent.book.notebooks[0].configuration,undefined);assert.ok(Buffer.byteLength(serialize(intent.configuration))<4096);
 const created=await new LabBookCreation(project,fixture.deviceStore).resume({id:bookCommand.id,username:'',password:''});assert.equal(created.book.labBookId,bookId);
 assert.equal((await commands.open({...draftOwner,create:true})).draft,null,'Completion left the consumed exact creation draft');assert.deepEqual(await books.create(bookCommand),created);
 const bookRoot=path.join(projectRoot,bookCommand.book.title),bookVault=await verifyAccess(await readAccess(bookRoot),'','',{deviceStore:fixture.deviceStore});vaults.push(bookVault);const book=new LabBookStorage(bookRoot,bookId,bookVault);
 await book.catalogue(async store=>{const snapshot=await store.snapshot(),configuration=snapshot.metadata.notebooks[0].configuration;assert.equal(configuration.owner.workspaceId,snapshot.metadata.id);assert.notEqual(configuration.owner.workspaceId,projectMetadata.id);const reader=await new ConfigurationDocuments(store).verify(configuration.owner,configuration),section=(await reader.window({collection:'sections'})).rows[0];assert.equal(section.value.label,'Draft selected schema');assert.notEqual(section.key,draftSection);assert.equal((await reader.window({collection:'choices',sectionId:section.key,fieldKey:'condition',offset:96})).rows[0].value,'Choice 96');});
 // A completed exact command cannot consume a later draft for the same absent
 // parent-catalogue member: that draft belongs to a different editor revision.
 const later=await commands.change({...draftOwner,create:true,commandId:randomUUID(),configurationPin:null,draftId:null,expectedRevision:null,operations:[{type:'append',collection:'sections',value:schema(randomUUID(),'Later unpublished work').sections[0]}]});
 assert.deepEqual(await books.create(bookCommand),created);assert.equal((await commands.open({...draftOwner,create:true})).draft.revision,later.draft.revision);
 await assert.rejects(books.create({...bookCommand,book:{...bookCommand.book,title:'Different request'}}),{code:'CONFLICT'});
 await assert.rejects(readFile(path.join(bookRoot,'.observanda/copy-in-progress')),{code:'ENOENT'});
});
