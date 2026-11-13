import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {randomUUID} from 'node:crypto';
process.once('message',async({runtimeDirectory})=>{
 try{
  const owner=new WorkspaceDatabases({directory:runtimeDirectory,ownerId:randomUUID(),env:process.env});const env=await owner.scratch(),{root}=await owner.scratchStart;
  // Like a running application, stay alive until the test terminates this process:
  // a temporary database alone never keeps a process alive.
  setInterval(()=>{},60000);
  process.send({type:'ready',root,url:env.OBSERVANDA_DATABASE_URL});
 }catch(error){process.stderr.write(error.stack);process.exitCode=1;process.disconnect();}
});
