import {test} from 'node:test';
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
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {Workspace} from '../src/storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectReferenceAliases} from '../src/project-reference-aliases.js';
import {referenceOriginKey} from '../src/research-reference-namespace.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {TestDeviceStore} from './device-fixture.js';
async function result(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
const calculation=(workspaceId,id,name,links=[])=>({workspaceId,commandId:randomUUID(),action:'calculation.save',payload:{id,expectedRevision:null,data:{name,links,engine:1,mode:'expression',angle:'rad',expression:'2+3',digits:'',fromBase:10,toBase:16}}});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-reference-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];let app;
 t.after(async()=>{await app?.close();await provider.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-module-reference-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
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
test('module reference APIs discover and resolve owner summaries, save links, isolate grants and preserve unavailable targets',{timeout:180000},async t=>{
 const f=await fixture(t),id=randomUUID(),ref={workspaceId:f.a.namespaceId,type:'calculation',id},foreignRecord={workspaceId:f.a.namespaceId,type:'record',id:randomUUID()},prefix=f.other+'/modules/references/',host=f.b.namespaceId;
 const record={...sampleNotebook().entries[0],id:foreignRecord.id,notebookId:f.a.labBookId,title:'Measured observation'};
 await result(await f.call(f.own+'/research/records/save',{workspaceId:f.a.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]}));
 await result(await f.call(f.own+'/modules/command',calculation(f.a.namespaceId,id,'Target calculation')));
 await result(await f.call(f.other+'/modules/command',calculation(host,id,'Same identity, different owner')));
 const parentTarget=calculation(f.project.namespaceId,randomUUID(),'Project calculation');await result(await f.call(f.base+'/modules/command',parentTarget));
 const owners=await result(await f.call(prefix+'owners',{workspaceId:host,projectId:null,search:'',offset:0,limit:25,revision:null}));assert.ok(owners.items.some(row=>row.workspaceId===f.initial.id));assert.ok(owners.items.some(row=>row.workspaceId===f.project.namespaceId));
 const books=await result(await f.call(prefix+'owners',{workspaceId:host,projectId:f.projectId,search:'',offset:0,limit:25,revision:null}));assert.deepEqual(new Set(books.items.map(row=>row.workspaceId)),new Set([f.a.namespaceId,host,f.project.namespaceId]));
 const original=ModuleCatalogue.prototype.selected;ModuleCatalogue.prototype.selected=()=>{throw Error('Labels and discovery cannot load module originals');};
 try{
  const page=await result(await f.call(prefix+'query',{workspaceId:host,sourceId:f.a.namespaceId,types:['record','calculation'],query:'',cursor:null,limit:1}));assert.equal(page.items.length,1);assert.equal(page.total,2);assert.match(page.revision,/^[a-f0-9]{64}$/);
  const next=await result(await f.call(prefix+'query',{workspaceId:host,sourceId:f.a.namespaceId,types:['record','calculation'],query:'',cursor:page.nextCursor,limit:1}));assert.equal(next.offset,1);assert.notEqual(next.items[0].reference.type,page.items[0].reference.type);
  const back=await result(await f.call(prefix+'query',{workspaceId:host,sourceId:f.a.namespaceId,types:['record','calculation'],query:'',cursor:next.previousCursor,limit:1}));assert.deepEqual(back.items,page.items);
  const labels=await result(await f.call(prefix+'labels',{workspaceId:host,references:[ref,{...ref,workspaceId:host},foreignRecord,{workspaceId:f.project.namespaceId,type:'calculation',id:parentTarget.payload.id}]}));assert.deepEqual(labels.items.map(item=>item.title),['Target calculation','Same identity, different owner','Measured observation','Project calculation']);
  const opened=await result(await f.call(prefix+'resolve',{workspaceId:host,target:ref}));assert.equal(opened.owner.labBookId,f.a.labBookId);assert.equal(opened.openType,'calculation');
 }finally{ModuleCatalogue.prototype.selected=original;}
 const source=calculation(host,randomUUID(),'Linked calculation',[ref,foreignRecord]);const saved=await result(await f.call(f.other+'/modules/command',source));assert.deepEqual(saved.entities[0].data.links,[ref,foreignRecord]);
 const incoming=await result(await f.call(f.own+'/modules/references/incoming',{workspaceId:f.a.namespaceId,target:foreignRecord,types:['calculation'],query:'',cursor:null,limit:25}));assert.ok(incoming.items.some(item=>item.reference.workspaceId===host&&item.reference.id===source.payload.id));
 // An occupied source research writer and unrelated sibling writer do not block summaries.
 let release,entered;const gate=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve),busy=f.workspace.withLock(()=>f.parent.withLock(()=>f.sibling.withLock(async()=>{entered();await hold;})));await gate;
 try{assert.equal((await f.call(prefix+'resolve',{workspaceId:host,target:ref})).status,200);}finally{release();await busy;}
 const second=await f.client();await result(await f.call(f.own+'/access/lock',{}));
 const denied=await result(await f.call(prefix+'resolve',{workspaceId:host,target:ref}),401);assert.equal(denied.projectId,f.projectId);assert.equal(denied.labBookId,f.a.labBookId);
 assert.equal((await result(await f.call(prefix+'labels',{workspaceId:host,references:[ref]}))).items[0].status,'unavailable');
 // Another client may authorize independently; it cannot lend its grant to the locked caller.
 await result(await second(f.own+'/access/unlock',{}));assert.equal((await second(prefix+'resolve',{workspaceId:host,target:ref})).status,200);assert.equal((await f.call(prefix+'resolve',{workspaceId:host,target:ref})).status,401);
 const retained={...source,commandId:randomUUID(),payload:{...source.payload,expectedRevision:1,data:{...source.payload.data,name:'Retained link'}}};await result(await f.call(f.other+'/modules/command',retained));
 await result(await f.call(f.other+'/modules/command',calculation(host,randomUUID(),'Denied new link',[ref])),401);
 await result(await f.call(f.own+'/access/unlock',{}));
 await result(await f.call(f.own+'/storage/rename',{id:randomUUID(),expectedName:f.a.directory,name:'Measurements Renamed'}));assert.equal((await result(await f.call(prefix+'resolve',{workspaceId:host,target:ref}))).title,'Target calculation');
 await result(await f.call(f.own+'/storage/delete',{id:randomUUID(),expectedName:'Measurements Renamed'}));const gone=await result(await f.call(prefix+'labels',{workspaceId:host,references:[ref]}));assert.equal(gone.items[0].status,'unavailable');assert.equal(Object.hasOwn(gone.items[0],'title'),false);
 const removed={...retained,commandId:randomUUID(),payload:{...retained.payload,expectedRevision:2,data:{...retained.payload.data,links:[]}}};await result(await f.call(f.other+'/modules/command',removed));
 const operations=(await result(await f.call('/api/activity'))).operations;assert.equal(operations.some(row=>row.kind.includes('/modules/references/')),false);
});
test('saved legacy research references use the exact authenticated identity witness, never whole namespace equivalence',{timeout:120000},async t=>{
 const f=await fixture(t),namespace=f.project.namespaceId,record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:randomUUID(),title:'Retained target'},book=(await f.parent.read()).book;
 // Seed a retained research summary in the disposable project through its real save path.
 record.notebookId=book.notebooks[0]?.id;
 if(!record.notebookId){const opened=await result(await f.call(f.base+'/workspace/read/start',{})),notebook={...sampleNotebook().notebooks[0],id:randomUUID(),projectId:f.projectId};record.notebookId=notebook.id;await result(await f.call(f.base+'/workspace/structure',{etag:opened.etag,change:{kind:'notebook',value:notebook},response:'outline',commandId:randomUUID()}));}
 await result(await f.call(f.base+'/research/records/save',{workspaceId:namespace,changes:[{id:record.id,expectedRevision:null,record}]}));
 const rootRead=await result(await f.call('/api/workspace/read/start',{})),rootProject={...sampleNotebook().projects[0],id:randomUUID()},rootBook={...sampleNotebook().notebooks[0],id:randomUUID(),projectId:rootProject.id};
 let structure=await result(await f.call('/api/workspace/structure',{etag:rootRead.etag,change:{kind:'project',value:rootProject},response:'outline',commandId:randomUUID()}));
 structure=await result(await f.call('/api/workspace/structure',{etag:structure.etag,change:{kind:'notebook',value:rootBook},response:'outline',commandId:randomUUID()}));
 await result(await f.call('/api/research/records/save',{workspaceId:f.initial.id,changes:[{id:record.id,expectedRevision:null,record:{...record,notebookId:rootBook.id,title:'Stale retained copy'}}]}));
 const sourceNamespace=f.initial.id,ref={workspaceId:sourceNamespace,type:'record',id:record.id},witness={version:1,projectId:f.projectId,namespaceId:namespace,sourceNamespace,kind:'record',id:record.id};
 await f.parent.withLock(()=>f.parent.catalogue(async store=>{await store.putObject('project:research-migration',{version:1,projectId:f.projectId,namespaceId:namespace,sourceNamespace});await store.putObject(referenceOriginKey(witness),witness);}));
 const before=await f.registry.read(),aliases=await new ProjectReferenceAliases(f.workspace).prepare(before.value.aliases,{version:1,sourceNamespace,namespaceId:namespace,projectId:f.projectId},[{kind:'record',id:record.id}]);await f.registry.change(before.revision,value=>({...value,aliases}));
 const route=f.other+'/modules/references/resolve',host=f.b.namespaceId,opened=await result(await f.call(route,{workspaceId:host,target:ref}));assert.deepEqual(opened.reference,ref);assert.equal(opened.owner.workspaceId,namespace);assert.equal(opened.title,record.title);
 await result(await f.call('/api/modules/command',calculation(f.initial.id,randomUUID(),'Link from retained address',[ref])));
 await result(await f.call(f.base+'/access/lock',{}));
 await result(await f.call('/api/modules/command',calculation(f.initial.id,randomUUID(),'Stale copy must not grant access',[ref])),401);
 await result(await f.call(f.base+'/access/unlock',{}));
 await result(await f.call(route,{workspaceId:host,target:{...ref,id:randomUUID()}}),404);
 await f.parent.withLock(()=>f.parent.catalogue(store=>store.putObject(referenceOriginKey(witness),{...witness,id:randomUUID()})));
 await result(await f.call(route,{workspaceId:host,target:ref}),404);
});
