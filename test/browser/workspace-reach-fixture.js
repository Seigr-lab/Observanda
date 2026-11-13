import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {workDirectory} from '../../scripts/work-directory.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

// One workspace with an openable project, a password-locked project and a
// separate second workspace. Every project has a shared and a private record
// in its own lab book. Folders live under .local/test-work, never the system
// temporary folder.
async function project(f,host,title,password,keys){
 const book=sampleNotebook();book.title=book.projects[0].title=title;book.notebooks[0].title=title+' lab book';
 book.entries[0].title=title+' shared observation';book.entries[2].title=title+' private note';
 const access=await createWorkspaceAccess('',password,f.deviceStore),key=takeCreatedVault(access);keys.push(key);
 const registry=new ProjectRegistry(f.workspace,host.id),storage=await initializeProjectLocation(path.join(f.workspace.root,title),book.projects[0].id,book,access,key);
 await registry.attach(storage,{expected:(await registry.read()).revision});
 return {book,storage,registry,shared:book.entries[0],private:book.entries[2]};
}

export async function workspaceReachFixture(name){
 const work=await workDirectory('test-work'),directory=await mkdtemp(path.join(work,name+'-'));
 const runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];
 try{
  const host=sampleNotebook();host.entries[0].title='Workspace field note';
  const f=await encryptedFixture(path.join(directory,'first'),host);keys.push(f.vault);
  const apiary=await project(f,host,'Apiary project','',keys),sealed=await project(f,host,'Sealed archive','Archive password',keys);
  const secondHost=sampleNotebook(),g=await encryptedFixture(path.join(directory,'second'),secondHost);keys.push(g.vault);
  const foreign=await project(g,secondHost,'Other workspace project','',keys);
  return {directory,f,host,apiary,sealed,foreign,secondHost,sealedPassword:'Archive password',
   async close(){
    try{await runtime.close();}finally{
     detach();await Promise.all(keys.map(clearVault));
     if(path.dirname(directory)!==work||!path.basename(directory).startsWith(name+'-'))throw Error('Invalid test directory');
     await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
   }};
 }catch(error){await runtime.close();detach();await Promise.all(keys.map(clearVault));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});throw error;}
}
