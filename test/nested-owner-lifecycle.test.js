import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {Workspace} from '../src/storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {RecordWriting} from '../src/record-writing.js';
import {recordRevision} from '../src/research.js';
import {TestDeviceStore} from './device-fixture.js';

// One continuous application journey: later operations consume the exact owners,
// records and references produced by earlier ones rather than rebuilding fixtures.
test('nested owners retain concurrent work, evidence and links through rename, placement and independent reopening',{timeout:600000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-nested-lifecycle-'));
 const runtime={directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}};
 let provider=new WorkspaceDatabases(runtime),detach=installDatabaseProvider(provider);
 const keys=[],device=new TestDeviceStore({file:path.join(directory,'device.key')});
 async function restartDatabases(){await provider.close();detach();provider=new WorkspaceDatabases(runtime);detach=installDatabaseProvider(provider);}
 let server,release,pending;
 t.after(async()=>{
  release?.();await pending?.catch(()=>{});await server?.close();await provider.close();detach();keys.forEach(clearVault);
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-nested-lifecycle-'));
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 async function initialize(title){
  const access=await createWorkspaceAccess('','',device),key=takeCreatedVault(access),root=path.join(directory,title);keys.push(key);
  await initializeLocation(root,createNotebook(title),access,key);return {root,key};
 }
 async function open(root){
  server=await startServer({root,port:0,headless:true,deviceStore:device,preferencesFile:path.join(directory,'preferences.json')});
  const session=await fetch(server.origin+'/api/session',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify({token:server.launchToken})});
  assert.equal(session.status,200,await session.clone().text());const cookie=session.headers.get('set-cookie').split(';')[0];let context;
  const raw=(route,{method='GET',body,headers={}}={})=>fetch(server.origin+route,{signal:AbortSignal.timeout(180000),method,body,headers:{Origin:server.origin,Cookie:cookie,...(context?{'X-Observanda-Workspace':context}:{}),...headers}});
  const call=async(route,data)=>{
   const response=await raw(route,data===undefined?{}:{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json','X-Observanda-Wait':'1'}});
   assert.equal(response.status,200,route+': '+await response.clone().text());return response.json();
  };
  context=(await call('/api/storage')).contextId;return {call,raw,adopt:value=>{context=value.contextId;},context:()=>context};
 }
 const initial=await initialize('Research Workspace 1');let root=initial.root,api=await open(root);
 const projectRoute=id=>'/api/projects/'+id;
 const bookRoute=book=>projectRoute(book.projectId)+'/lab-books/'+book.labBookId;
 const createProject=async(title,parentId=null)=>(await api.call('/api/projects/create',{id:randomUUID(),username:'',password:'',project:{id:randomUUID(),title,parentId,description:'',share:false,logoId:null}})).project;
 const parent=await createProject('Field Project 1'),child=await createProject('Nested Project \u00c5 2',parent.projectId),sibling=await createProject('Independent Project 3');
 const projects=[parent,child,sibling],books=[];
 for(const [owner,title] of [[parent,'Observations 1'],[child,'Observations caf\u00e9 2']]){
  const book=(await api.call(projectRoute(owner.projectId)+'/lab-books/create',{id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:owner.projectId,title}})).book;
  book.projectId=owner.projectId;books.push(book);assert.equal(book.root,path.join(owner.root,title));
 }
 const bindings=await Promise.all([root,...projects.map(p=>p.root),...books.map(b=>b.root)].map(catalogueBinding));
 assert.equal(new Set(bindings.map(b=>b.id)).size,6);
 for(const [index,owner] of [...projects,...books].entries()){
  const binding=bindings[index+1];assert.equal(binding.placement,index<3?'project':'lab-book');
  assert.equal(binding[index<3?'projectId':'labBookId'],index<3?owner.projectId:owner.labBookId);
  assert.ok((await stat(path.join(owner.root,'.observanda/postgresql/data/PG_VERSION'))).isFile());
 }
 const records=books.map((book,index)=>({...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId:book.labBookId,title:'Observation '+index,body:'Original observation '+index,attachments:[],figures:[],relations:[],sections:[]}));
 for(const [index,book] of books.entries())await api.call(bookRoute(book)+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:records[index].id,expectedRevision:null,record:records[index]}]});
 const address=index=>({workspaceId:books[index].namespaceId,recordId:records[index].id,sectionId:null});
 const saved=await Promise.all(books.map((book,index)=>api.call(bookRoute(book)+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:[records[index].id]})));
 const retained={workspaceId:books[1].namespaceId,kind:'record',id:records[1].id,revision:recordRevision(saved[1].book.entries[0])};
 const writing=await Promise.all(books.map((book,index)=>api.call(bookRoute(book)+'/research/records/writing/read',address(index))));
 let entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),select=RecordWriting.prototype.select;
 const held=t.mock.method(RecordWriting.prototype,'select',async function(store,command){
  if(command.recordId===records[0].id&&command.expectedRevision){entered();await gate;}
  return select.call(this,store,command);
 });
 pending=api.call(bookRoute(books[0])+'/research/records/writing/save',{...address(0),expectedRevision:writing[0].revision,value:{body:'Later observation 0'}});
 try{
  await Promise.race([ready,pending.then(()=>{throw Error('First write did not reach its owner transaction');})]);
  await api.call(bookRoute(books[1])+'/research/records/writing/save',{...address(1),expectedRevision:writing[1].revision,value:{body:'Later observation 1'}});
  assert.equal((await api.call(bookRoute(books[1])+'/research/records/writing/read',address(1))).value.body,'Later observation 1');
 }finally{release();await pending;pending=null;held.mock.restore();}
 const current=(await api.call(bookRoute(books[0])+'/workspace/read/selection',{workspaceId:books[0].namespaceId,ids:[records[0].id]})).book.entries[0];
 await api.call(bookRoute(books[0])+'/research/records/save',{workspaceId:books[0].namespaceId,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,relations:[{id:randomUUID(),type:'Builds on',target:retained,label:'Earlier independent observation'}]}}]});
 const bytes=Buffer.from('Observation readings\n1,2,3\n'),prefix=bookRoute(books[0]);
 const upload=await api.call(prefix+'/research/materials/start',{recordId:records[0].id,name:'measurements.csv',size:bytes.length});
 assert.equal((await api.raw(prefix+'/research/materials/chunk/'+upload.id+'/0',{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream'}})).status,200);
 const preparing=await api.raw(prefix+'/research/materials/finish',{method:'POST',body:JSON.stringify({id:upload.id}),headers:{'Content-Type':'application/json'}});assert.equal(preparing.status,202,await preparing.clone().text());
 let job;const deadline=Date.now()+60000;
 do{job=(await api.call(prefix+'/research/materials/job',{id:upload.id})).job;if(['completed','failed'].includes(job.state))break;await delay(50);}while(Date.now()<deadline);
 assert.equal(job.state,'completed',JSON.stringify(job));const evidence={...job.result,workspaceId:books[0].namespaceId};
 t.diagnostic('Independent writers, retained link and original evidence saved');
 const oldBookRoot=books[0].root;
 await api.call(bookRoute(books[0])+'/storage/rename',{id:randomUUID(),expectedName:books[0].directory,name:'Renamed observations \u00c5 1'});
 books[0].directory='Renamed observations \u00c5 1';books[0].root=path.join(parent.root,books[0].directory);await assert.rejects(stat(oldBookRoot),{code:'ENOENT'});
 const outline=await api.call(projectRoute(parent.projectId)+'/workspace/read/start',{}),oldParentRoot=parent.root;
 await api.call(projectRoute(parent.projectId)+'/settings/save',{id:randomUUID(),etag:outline.etag,project:{...outline.metadata.projects[0],title:'Renamed Field Project 1'}});
 const relocate=(from,to)=>{for(const owner of [...projects,...books]){const relative=path.relative(from,owner.root);if(relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))owner.root=path.join(to,relative);}};
 relocate(oldParentRoot,path.join(root,'Renamed Field Project 1'));await assert.rejects(stat(oldParentRoot),{code:'ENOENT'});
 const workspaceBefore=await api.call('/api/notebook'),renamed=await api.call('/api/storage/rename',{name:'Renamed Workspace caf\u00e9 2',etag:workspaceBefore.etag});api.adopt(renamed);
 relocate(root,renamed.root);root=renamed.root;await assert.rejects(stat(initial.root),{code:'ENOENT'});
 assert.equal((await api.call('/api/notebook')).book.title,path.basename(root));
 const copies=path.join(directory,'Copies'),bookCopies=path.join(copies,'Books'),projectCopies=path.join(copies,'Projects');await mkdir(bookCopies,{recursive:true});await mkdir(projectCopies);
 await api.call(bookRoute(books[0])+'/storage/copy',{id:randomUUID(),parent:bookCopies});
 const copiedBook=path.join(bookCopies,books[0].directory),beforeMove=books[0].root;
 const placed=await api.call(bookRoute(books[0])+'/storage/move',{id:randomUUID(),projectId:child.projectId});
 books[0].projectId=child.projectId;books[0].root=placed.book.root;assert.equal(books[0].root,path.join(child.root,books[0].directory));await assert.rejects(stat(beforeMove),{code:'ENOENT'});
 assert.equal((await api.call('/api/projects/reference',retained)).value.body,'Original observation 1');
 await api.call(projectRoute(parent.projectId)+'/storage/copy',{id:randomUUID(),parent:projectCopies});
 const copiedProject=path.join(projectCopies,path.basename(parent.root)),beforePlacement=parent.root;
 await api.call(projectRoute(parent.projectId)+'/storage/move',{id:randomUUID(),parentId:sibling.projectId,expectedParentId:null});
 relocate(beforePlacement,path.join(sibling.root,path.basename(beforePlacement)));await assert.rejects(stat(beforePlacement),{code:'ENOENT'});
 for(const [index,book] of books.entries())assert.equal((await api.call(bookRoute(book)+'/research/records/writing/read',address(index))).value.body,'Later observation '+index);
 t.diagnostic('Workspace, project and book renamed; selected book and complete project copied and moved');
 await server.close();server=null;await restartDatabases();
 assert.equal(path.dirname(root),directory);await rename(root,path.join(directory,'Original workspace unavailable'));await assert.rejects(stat(root),{code:'ENOENT'});
 // The standalone selected-book copy remains readable without either parent.
 const copiedKey=await verifyAccess(await readAccess(copiedBook),'','',{deviceStore:device});keys.push(copiedKey);
 const independentBook=new LabBookStorage(copiedBook,books[0].labBookId,copiedKey);
 assert.equal((await independentBook.read()).book.entries[0].body,'Later observation 0');await provider.closeLabBook(copiedBook);
 const receiving=await initialize('Receiving Workspace 3');api=await open(receiving.root);
 const imported=await api.call('/api/projects/open',{id:randomUUID(),path:copiedProject,parentId:null,username:'',password:'',recovery:'',owners:[]});
 assert.equal(imported.project.root,path.join(receiving.root,'Renamed Field Project 1'));
 const copiedChild=path.join(imported.project.root,'Nested Project \u00c5 2');
 for(const book of books)book.root=path.join(copiedChild,book.directory);
 await server.close();server=null;await restartDatabases();
 assert.equal(path.dirname(copiedProject),projectCopies);await rename(copiedProject,path.join(projectCopies,'Backup unavailable'));
 api=await open(receiving.root);
 for(const [index,book] of books.entries()){
  const info=await api.call(bookRoute(book)+'/workspace/read/start',{});assert.equal(info.metadata.title,path.basename(book.root));
  assert.equal((await api.call(bookRoute(book)+'/research/records/writing/read',address(index))).value.body,'Later observation '+index);
  const binding=await catalogueBinding(book.root);assert.equal(binding.placement,'lab-book');assert.equal(binding.labBookId,book.labBookId);
  assert.notEqual(binding.id,bindings[index+4].id);
  const history=await api.call(bookRoute(book)+'/research/records/history/list',{workspaceId:book.namespaceId,recordId:records[index].id});assert.ok(history.versions.length>=2);if(index===1)assert.ok(history.versions.some(item=>item.revision===retained.revision));
 }
 const linked=(await api.call(bookRoute(books[0])+'/workspace/read/selection',{workspaceId:books[0].namespaceId,ids:[records[0].id]})).book.entries[0];assert.deepEqual(linked.relations[0].target,retained);
 assert.equal((await api.call('/api/projects/reference',retained)).value.body,'Original observation 1');
 const located=await api.call('/api/projects/reference-location',retained);assert.equal(located.projectId,child.projectId);assert.equal(located.labBookId,books[1].labBookId);
 const downloaded=await api.raw('/api/projects/material-reference/original/'+books[0].namespaceId+'/'+evidence.id+'/'+evidence.revision+'?context='+api.context());
 assert.equal(downloaded.status,200,await downloaded.clone().text());assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
 for(const [location,Class,id] of [[receiving.root,Workspace,null],[imported.project.root,ProjectStorage,parent.projectId],[copiedChild,ProjectStorage,child.projectId]]){
  const key=await verifyAccess(await readAccess(location),'','',{deviceStore:device});keys.push(key);
  const storage=Class===Workspace?new Class(location,key):new Class(location,id,key);assert.deepEqual((await storage.read()).book.entries,[]);
 }
 const read=await api.call(bookRoute(books[1])+'/research/records/writing/read',address(1));
 await api.call(bookRoute(books[1])+'/research/records/writing/save',{...address(1),expectedRevision:read.revision,value:{body:'New observation after independent reopening'}});
 assert.equal((await api.call('/api/projects/reference',retained)).value.body,'Original observation 1');
 t.diagnostic('Independent reopening retains dedicated databases, history, original evidence and cross-owner links');
});
