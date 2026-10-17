import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fork,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {findPostgres} from '../src/postgres-runtime.js';
import {sampleNotebook} from '../src/sample.js';

function within(promise,milliseconds,message){
 let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));
}
async function pidFile(root){return readFile(path.join(root,'.observanda/postgresql/data/postmaster.pid'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});}

for(const [kind,ownerIndex] of [['workspace',0],['project',1],['book',2]])test('desktop '+kind+' shutdown failure closes nested database owners and reopens retained work',{timeout:240000},async t=>{
 const runtime=await findPostgres({...process.env,...(process.env.OBSERVANDA_TEST_POSTGRES_BIN?{OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}:{})});
 assert.ok(runtime,'A qualified PostgreSQL runtime is required');
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-desktop-service-'));
 const preferencesFile=path.join(directory,'preferences.json'),roots=[],children=[];
 const env={...process.env,OBSERVANDA_DATABASE_URL:'',OBSERVANDA_POSTGRES_BIN:runtime.bin};
 t.after(async()=>{
  for(const child of children){if(child.process.exitCode===null&&child.process.signalCode===null)child.process.kill('SIGKILL');await child.exited;}
  // A failed assertion must not leave the deliberately orphaned reproduction
  // running. Stop only data directories created inside this test's own root.
  for(const root of roots){
   assert.ok(root.startsWith(directory+path.sep));
   if(await pidFile(root))await new Promise((resolve,reject)=>{
    const stop=spawn(path.join(runtime.bin,process.platform==='win32'?'pg_ctl.exe':'pg_ctl'),['-D',path.join(root,'.observanda/postgresql/data'),'-m','fast','-w','stop'],{windowsHide:true,stdio:'ignore',env});
    stop.once('error',reject);stop.once('exit',code=>code===0?resolve():reject(Error('Disposable database cleanup failed')));
   });
  }
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-desktop-service-'));
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 async function launch(unlockPassword){
  const child=fork(new URL('./fixtures/desktop-service-close.js',import.meta.url),[],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env,execArgv:[]});
  let errors='';child.stderr.on('data',bytes=>{errors+=bytes.toString();});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal}))),entry={process:child,exited};children.push(entry);
  const ready=await within(new Promise((resolve,reject)=>{
   child.once('error',reject);child.once('exit',()=>reject(Error('Desktop service exited before readiness: '+errors)));
   child.on('message',message=>{if(message?.type==='fixture-ready')child.send({type:'start',preferencesFile});if(message?.type==='ready')resolve(message);if(message?.type==='failed')reject(Error(message.message));});
  }),60000,'Desktop service did not become ready');
  const url=new URL(ready.url),origin=url.origin;
  const session=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:url.hash.slice(1)})});
  assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0];let context;
  const call=async(route,data)=>{
   const response=await fetch(origin+route,{signal:AbortSignal.timeout(60000),headers:{Origin:origin,Cookie:cookie,...(context?{'X-Observanda-Workspace':context}:{}),'Content-Type':'application/json','X-Observanda-Wait':'1'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});
   assert.ok(response.ok,route+': '+await response.clone().text());return response.json();
  };
  if(unlockPassword)await call('/api/access/unlock',{username:'',password:unlockPassword});
  context=(await call('/api/storage')).contextId;
  return {...entry,call,adopt:storage=>{context=storage.contextId;},errors:()=>errors};
 }
 const password='Synthetic desktop recovery passphrase';
 let service=await launch();
 const created=await service.call('/api/notebook/create',{title:'Retained desktop workspace',storageParent:directory,username:'',password});service.adopt(created.storage);roots.push(created.storage.root);
 const project=(await service.call('/api/projects/create',{id:randomUUID(),username:'',password,project:{id:randomUUID(),title:'Retained project',parentId:null,description:'',share:false,logoId:null}})).project;roots.push(project.root);
 const prefix='/api/projects/'+project.projectId;await service.call(prefix+'/access/unlock',{username:'',password});
 const book=(await service.call(prefix+'/lab-books/create',{id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId:project.projectId,title:'Retained book'}})).book;roots.push(book.root);
 const record={...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId:book.labBookId,title:'Observation before failed close',body:'Exact retained observation.',attachments:[],figures:[],relations:[],sections:[]};
 const bookPrefix=prefix+'/lab-books/'+book.labBookId;await service.call(bookPrefix+'/access/unlock',{username:'',password});
 await service.call(bookPrefix+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
 for(const root of roots)assert.ok((await pidFile(root)).trim(),'Owner must be running before shutdown');
 service.process.send({type:'inject-close-failure',owner:kind,root:roots[ownerIndex]});service.process.send({type:'stop'});
 const stopped=await within(service.exited,60000,'Desktop service did not exit after failed shutdown');
 for(const root of roots)assert.equal((await pidFile(root)).trim(),'','Desktop shutdown left a database process running');
 assert.equal(stopped.code,1,'Shutdown failure remains visible through the service exit code');
 service=await launch(password);
 await service.call(prefix+'/access/unlock',{username:'',password});await service.call(bookPrefix+'/access/unlock',{username:'',password});
 const reopened=await service.call(bookPrefix+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:[record.id]});assert.equal(reopened.book.entries[0].body,record.body);
 service.process.send({type:'stop'});assert.equal((await within(service.exited,60000,'Reopened desktop service did not close')).code,0,service.errors());
 for(const root of roots)assert.equal((await pidFile(root)).trim(),'');
});
