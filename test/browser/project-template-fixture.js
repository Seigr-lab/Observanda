import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
export async function projectTemplateFixture(directory,book){
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];
 const close=async()=>{await owner.close();detach();for(const vault of vaults)clearVault(vault);};
 try{
  const rootBook=sampleNotebook(),f=await encryptedFixture(path.join(directory,'Workspace'),rootBook);vaults.push(f.vault);
  const id=book.projects[0].id,access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);
  book.title=book.projects[0].title='Independent project';
  const workspace=await initializeProjectLocation(path.join(directory,'Independent project'),id,book,access,vault),registry=new ProjectRegistry(f.workspace,rootBook.id);
  await registry.attach(workspace,{expected:(await registry.read()).revision});return {workspace,vault,deviceStore:f.deviceStore,applicationRoot:f.workspace.root,close};
 }catch(error){await close();throw error;}
}
