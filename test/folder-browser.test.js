import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readFolder,createFolderBrowser} from '../src/folder-browser.js';
import {AppError} from '../src/errors.js';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {startServer} from '../src/server.js';

async function fixture(t,code){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-folder-worker-')),file=path.join(root,'worker.cjs');
 await writeFile(file,code);t.after(()=>rm(root,{recursive:true,force:true}));return file;
}
const listing={folder:os.tmpdir(),folders:[],breadcrumbs:[],total:0,offset:0,hasMore:false};
const emit=value=>'process.stdout.write('+JSON.stringify(JSON.stringify(value)+'\n')+');';
const alive='setInterval(()=>{},1000);';

test('a stuck optional drive keeps the completed folder listing and reachable shortcuts; its child exits', {timeout:10000},async t=>{
 const workerFile=await fixture(t,emit({listing})+emit({place:{name:'Home',path:os.homedir(),kind:'home'}})+alive);let child;
 const result=await readFolder({discover:true},{workerFile,placesTimeout:100,onSpawn:value=>child=value});
 assert.deepEqual(result.listing,listing);assert.equal(result.places[0].name,'Home');assert.equal(result.placesIncomplete,true);
 assert.ok(child.exitCode!==null||child.signalCode!==null);
 const overall=await readFolder({discover:true},{workerFile,timeout:1000,placesTimeout:5000});
 assert.deepEqual(overall.listing,listing);assert.equal(overall.placesIncomplete,true);
});
test('unavailable requested folders time out and active/pre-aborted reads terminate without returning partial success', {timeout:10000},async t=>{
 const workerFile=await fixture(t,alive);let child;
 await assert.rejects(readFolder({}, {workerFile,timeout:150,onSpawn:value=>child=value}),{code:'FOLDER_TIMEOUT'});
 assert.ok(child.exitCode!==null||child.signalCode!==null);
 const controller=new AbortController(),ready=Promise.withResolvers();
 const pending=readFolder({}, {workerFile,signal:controller.signal,onSpawn:value=>{child=value;ready.resolve();}});
 await ready.promise;controller.abort();await assert.rejects(pending,{code:'FOLDER_CANCELLED'});
 assert.ok(child.exitCode!==null||child.signalCode!==null);
 await assert.rejects(readFolder({}, {signal:controller.signal,onSpawn:()=>assert.fail('Spawned after cancellation')}),{code:'FOLDER_CANCELLED'});
});
test('malformed, excessive and incomplete worker output fails closed', {timeout:15000},async t=>{
 for(const source of ['process.stdout.write("not-json\\n");', 'process.stdout.write("x".repeat(5*1024*1024));'+alive,emit({listing})]){
  const workerFile=await fixture(t,source);await assert.rejects(readFolder({}, {workerFile}),{code:'IO'});
 }
 const workerFile=await fixture(t,emit({error:'EACCES'}));await assert.rejects(readFolder({}, {workerFile}),{code:'FOLDER_UNAVAILABLE'});
});
test('folder navigation reuses optional shortcuts briefly, refreshes after expiry and limits concurrent readers',async()=>{
 let clock=0;const calls=[];
 const browse=createFolderBrowser({now:()=>clock,read:async input=>{calls.push(input);return {listing,places:[{name:'Home',path:os.homedir(),kind:'home'}],placesIncomplete:true};}});
 await browse(os.tmpdir());await browse(os.tmpdir(),{search:'child'});assert.deepEqual(calls.map(c=>c.discover),[true,false]);clock=30001;await browse(os.tmpdir());assert.equal(calls[2].discover,true);
 const gate=Promise.withResolvers(),busy=createFolderBrowser({read:()=>gate.promise});
 const pending=Array.from({length:4},()=>busy(os.tmpdir()));await assert.rejects(busy(os.tmpdir()),{code:'FOLDER_BUSY'});
 gate.resolve({listing,places:[],placesIncomplete:false});await Promise.all(pending);await busy(os.tmpdir());
 await assert.rejects(browse('relative'),{code:'STORAGE_PATH'});await assert.rejects(browse(os.tmpdir(),{offset:-1}),{code:'INVALID'});
});

async function service(t,folderBrowser){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-folder-service-'));
 await new Workspace(root).create(sampleNotebook());
 const app=await startServer({root,port:0,headless:true,folderBrowser});
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const headers={Origin:app.origin,Cookie:auth.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 return {...app,root,headers,post:(route,data,extra={})=>fetch(app.origin+route,{method:'POST',headers,body:JSON.stringify(data),...extra})};
}
test('browsing never holds the workspace write gate, and a disconnected client cancels the read', {timeout:15000},async t=>{
 const ready=Promise.withResolvers(),stopped=Promise.withResolvers();
 const app=await service(t,(input,{signal})=>new Promise((resolve,reject)=>{ready.resolve();signal.addEventListener('abort',()=>{stopped.resolve();reject(new AppError('FOLDER_CANCELLED'));},{once:true});}));
 const controller=new AbortController();
 const browsing=app.post('/api/storage/browse',{path:app.root},{signal:controller.signal});const cancelled=assert.rejects(browsing);
 await ready.promise;
 const response=await fetch(app.origin+'/api/notebook',{headers:app.headers}),current=await response.json();
 current.book.description='Saved while a network folder is offline';
 const saved=await app.post('/api/notebook/save',current);assert.equal(saved.status,200);
 controller.abort();await cancelled;await stopped.promise;
 const again=await fetch(app.origin+'/api/notebook',{headers:app.headers});assert.equal((await again.json()).book.description,current.book.description);
});
test('locking cancels folder reads and never returns a listing from the old access context', {timeout:15000},async t=>{
 const ready=Promise.withResolvers(),stopped=Promise.withResolvers();
 const app=await service(t,(input,{signal})=>new Promise((resolve,reject)=>{ready.resolve();signal.addEventListener('abort',()=>{stopped.resolve();reject(new AppError('FOLDER_CANCELLED'));},{once:true});}));
 const browsing=app.post('/api/storage/browse',{});await ready.promise;
 assert.equal((await app.post('/api/access/lock',{})).status,200);await stopped.promise;assert.notEqual((await browsing).status,200);
});
