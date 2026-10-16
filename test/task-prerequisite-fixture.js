import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {Workspace} from '../src/storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {TestDeviceStore} from './device-fixture.js';
export async function result(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
export async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-task-prerequisites-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];let app;
 t.after(async()=>{await app?.close();await provider.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-task-prerequisites-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const root=path.join(directory,'Research Workspace'),initial=createNotebook('Research Workspace');await initializeLocation(root,initial,access,vault);const workspace=new Workspace(root,vault),registry=new ProjectRegistry(workspace,initial.id);
 app=await startServer({root,port:0,headless:true,deviceStore:device});
 async function client(){
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0],context=(await result(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}}))).contextId;
  const headers={Origin:app.origin,Cookie:cookie,'X-Observanda-Workspace':context};
  return (route,data)=>fetch(app.origin+route,{signal:AbortSignal.timeout(30000),method:data===undefined?'GET':'POST',headers:{...headers,'Content-Type':'application/json','X-Observanda-Wait':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 }
 const call=await client(),projectId=randomUUID(),base='/api/projects/'+projectId;
 const project=(await result(await call('/api/projects/create',{id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Field Project',description:'',share:false,logoId:null}}))).project;
 const book=async title=>(await result(await call(base+'/lab-books/create',{id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title}}))).book;
 const a=await book('Measurements'),b=await book('Calculations');
 async function storage(entry,Class,id){const key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});vaults.push(key);return new Class(entry.root,id,key);}
 return {directory,app,call,client,initial,workspace,registry,project,projectId,base,a,b,own:base+'/lab-books/'+a.labBookId,other:base+'/lab-books/'+b.labBookId,parent:await storage(project,ProjectStorage,projectId),selected:await storage(a,LabBookStorage,a.labBookId),sibling:await storage(b,LabBookStorage,b.labBookId)};
}
