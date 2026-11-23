import {Workspace} from '../../src/storage.js';
import {WorkspaceRenames} from '../../src/workspace-rename.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';

// Only a synthetic fixture is passed over this private IPC channel. The child
// uses the parent's installation identity, as a restarted application would,
// and the parent kills it at the named rename boundary without any cleanup.
process.once('message',async({root,vault,journal,name,boundary,ownerId,runtime})=>{
 try{
  installDatabaseProvider(new WorkspaceDatabases({directory:runtime,ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}));
  await new WorkspaceRenames(journal).begin(new Workspace(root,{...vault,key:Buffer.from(vault.key,'base64')}),name,{checkpoint:async phase=>{
   if(phase!==boundary)return;process.send({type:'checkpoint'});await new Promise(()=>{});
  }});
  process.send({type:'unexpected-completion'});
 }catch(error){process.send({type:'error',message:error.code??error.message});}
});
