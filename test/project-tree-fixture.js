import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {initializeLocation} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {catalogueBinding} from '../src/postgres-activation.js';

export async function projectTreeFixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-rename-')),runtime={directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}},vaults=[];let provider=new WorkspaceDatabases(runtime),detach=installDatabaseProvider(provider);
 const stopProvider=async()=>{await provider.close();detach();},restartProvider=()=>{provider=new WorkspaceDatabases(runtime);detach=installDatabaseProvider(provider);return provider;};
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-rename-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),metadata=createNotebook('Research Workspace 1'),root=path.join(directory,metadata.title),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);vaults.push(vault);await initializeLocation(root,metadata,access,vault);
 const workspace=new Workspace(root,vault),registry=new ProjectRegistry(workspace,metadata.id),creation=new ProjectCreation(registry,deviceStore),projects=[],books=[];
 for(const title of ['Field Project 1','Nested Project \u00c5 2']){
  const projectId=randomUUID(),{project:entry}=await creation.create({id:randomUUID(),username:'',password:'',project:{id:projectId,title,description:'',parentId:projects[0]?.projectId??null,share:false,logoId:null}}),key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore});vaults.push(key);
  const storage=new ProjectStorage(entry.root,projectId,key);projects.push({...entry,key,binding:await catalogueBinding(entry.root),inode:(await stat(path.join(entry.root,'.observanda/postgresql/data/PG_VERSION'))).ino});
  const {book}=await new LabBookCreation(storage,deviceStore).create({id:randomUUID(),username:'',password:'Protected observations 456!',book:{id:randomUUID(),projectId,title:'Observations for '+title}}),bookKey=await verifyAccess(await readAccess(book.root),'','Protected observations 456!',{deviceStore});vaults.push(bookKey);const bookStorage=new LabBookStorage(book.root,book.labBookId,bookKey);
  await bookStorage.update(value=>{value.entries=[{...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId,title:'Retained observation'}];return value;});books.push({...book,projectId,key:bookKey,binding:await catalogueBinding(book.root),before:await bookStorage.read(),inode:(await stat(path.join(book.root,'.observanda/postgresql/data/PG_VERSION'))).ino});
 }
 return {runtime,stopProvider,restartProvider,directory,provider,deviceStore,workspace,registry,creation,projects,books,root};
}

export async function destinationProject(f,t,password=''){
 const id=randomUUID(),result=await f.creation.create({id:randomUUID(),username:'',password,project:{id,title:'Destination Project',description:'',parentId:null,share:false,logoId:null}}),key=await verifyAccess(await readAccess(result.project.root),'',password,{deviceStore:f.deviceStore});t.after(()=>clearVault(key));return {...result.project,key};
}
