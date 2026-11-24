// A workspace served by a real app, with an owner session, for agent API tests.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {TestDeviceStore} from './device-fixture.js';

export async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
export async function agentServerFixture(t,prefix='observanda-agent-api-'){
 const directory=await mkdtemp(path.join(os.tmpdir(),prefix)),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access),root=path.join(directory,'Research Workspace 1');
 await initializeLocation(root,createNotebook('Research Workspace 1'),access,vault);
 const app=await startServer({root,port:0,headless:true,deviceStore:device});
 t.after(async()=>{await app.close();await provider.close();detach();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200);
 const session=response.headers.get('x-observanda-session').split(';')[0],contextId=(await result(await fetch(app.origin+'/api/storage',{headers:{'X-Observanda-Session':session}}))).contextId;
 // The owner's own app requests: same origin, session and workspace context.
 const owner=(route,data={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(45000),method:'POST',headers:{Origin:app.origin,'X-Observanda-Session':session,'Content-Type':'application/json','X-Observanda-Workspace':contextId,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});
 const createProject=async(title,password='')=>(await result(await owner('/api/projects/create',{id:randomUUID(),username:'',password,project:{id:randomUUID(),title,description:'',share:false,logoId:null}}))).project;
 const createBook=async(projectId,title,password='')=>(await result(await owner('/api/projects/'+projectId+'/lab-books/create',{id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId,title}}))).book;
 // A program on this computer: no browser origin and no session, only its key.
 const agent=(route,{key,data,method=data===undefined?'GET':'POST',headers={}}={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(45000),method,headers:{...(key?{Authorization:'Bearer '+key}:{}),...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
 return {directory,root,app,device,vault,session,contextId,owner,agent,createProject,createBook};
}
