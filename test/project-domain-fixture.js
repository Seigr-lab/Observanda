import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectDomains} from '../src/project-domains.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
export async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-project-domains-')),vaults=[];
 const runtime=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);
 t.after(async()=>{await runtime.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-project-domains-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook(),projectId=book.projects[0].id,access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(root,'device')})),vault=takeCreatedVault(access);vaults.push(vault);
 book.title=book.projects[0].title='project';
 const storage=await initializeProjectLocation(path.join(root,'project'),projectId,book,access,vault),domains=new ProjectDomains(storage,book.id);
 return {root,runtime,book,projectId,vault,storage,domains};
}
export const calculation=f=>({workspaceId:f.book.id,commandId:randomUUID(),action:'calculation.save',payload:{id:randomUUID(),expectedRevision:null,data:{name:'Independent calculation',links:[],engine:1,mode:'expression',angle:'rad',expression:'2+3',digits:'',fromBase:10,toBase:16}}});
export const calendar=f=>({workspaceId:f.book.id,commandId:randomUUID(),action:'calendar.save',payload:{id:randomUUID(),expectedRevision:null,data:{name:'Independent calendar',projectId:f.projectId,color:'#123456',archived:false}}});
