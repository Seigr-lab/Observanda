import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createFolderPicker,detectFolderPicker,dialogInvocation,dialogResult,initialFolder,runDialogProcess} from '../src/native-folder-picker.js';
import {startServer} from '../src/server.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {createNotebook} from '../src/model.js';
import {copyPlan,copyWorkspace,encryptedCopy,initializeLocation,workspaceManifest} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';

const backend={mode:'native',backend:'windows',command:'trusted-system-program',args:['fixed-script']};
const selected=folder=>({code:0,stdout:JSON.stringify({folder,cancelled:false})});
const cancelled={code:0,stdout:JSON.stringify({folder:null,cancelled:true})};

test('headless and SSH sessions never launch a desktop probe; Linux respects its desktop and installed dialog tools',async()=>{
 const forbidden=async()=>{throw new Error('Must not run');};
 assert.equal((await detectFolderPicker({headless:true,run:forbidden})).mode,'server');
 assert.equal((await detectFolderPicker({env:{SSH_CONNECTION:'tunnel'},run:forbidden})).mode,'server');
 assert.equal((await detectFolderPicker({platform:'linux',env:{},run:forbidden})).mode,'server');
 const calls=[];const kde=await detectFolderPicker({platform:'linux',env:{DISPLAY:':0',XDG_CURRENT_DESKTOP:'KDE'},find:async name=>{calls.push(name);return '/usr/bin/'+name;}});
 assert.equal(kde.backend,'kdialog');assert.deepEqual(calls,['kdialog']);
 const gnome=await detectFolderPicker({platform:'linux',env:{WAYLAND_DISPLAY:'wayland-0',XDG_CURRENT_DESKTOP:'GNOME'},find:async name=>'/usr/bin/'+name});assert.equal(gnome.backend,'zenity');
 assert.equal((await detectFolderPicker({platform:'linux',env:{DISPLAY:':0'},find:async()=>null})).mode,'unavailable');
});

test('Windows uses an interactive-desktop probe and never confuses probe failure with an available native picker',async()=>{
 let invocation;const detect=interactive=>detectFolderPicker({platform:'win32',env:{SystemRoot:'C:\Windows'},run:async(command,args)=>{invocation={command,args};return {code:0,stdout:JSON.stringify({interactive})};}});
 assert.equal((await detect(true)).backend,'windows');assert.ok(invocation.command.endsWith('powershell.exe'));assert.ok(invocation.args.includes('-Probe'));assert.ok(invocation.args.includes('-STA'));
 assert.equal((await detect(false)).mode,'server');assert.equal((await detectFolderPicker({platform:'win32',env:{},run:async()=>({code:1,stdout:''})})).mode,'unavailable');
});

test('platform adapters pass special characters as data and distinguish cancel from native failures',()=>{
 const initial="/research/O'Brien & $(literal)/\u03bc";
 const windows=dialogInvocation(backend,initial);assert.equal(JSON.parse(windows.input).initialPath,initial);assert.deepEqual(windows.args,backend.args);
 assert.equal(dialogInvocation({...backend,backend:'macos'},initial).args.at(-1),initial);
 assert.equal(dialogInvocation({...backend,backend:'kdialog'},initial).args.at(-1),initial);
 assert.equal(dialogInvocation({...backend,backend:'zenity'},initial).args.at(-1),'--filename='+initial+path.sep);
 assert.equal(dialogResult('windows',cancelled),null);assert.equal(dialogResult('windows',selected(initial)),initial);
 assert.equal(dialogResult('macos',{code:0,stdout:'selected:'+initial+'\n'}),initial);
 assert.equal(dialogResult('macos',{code:0,stdout:'cancelled:\n'}),null);
 for(const kind of ['zenity','kdialog']){assert.equal(dialogResult(kind,{code:1,stdout:''}),null);assert.throws(()=>dialogResult(kind,{code:2,stdout:'failure'}),{code:'FOLDER_PICKER_FAILED'});assert.equal(dialogResult(kind,{code:0,stdout:initial+'  \n'}),initial+'  ');}
 for(const stdout of ['broken','{}','null','{"cancelled":true,"folder":"unexpected"}'])assert.throws(()=>dialogResult('windows',{code:0,stdout}),{code:'FOLDER_PICKER_FAILED'});
});

test('picker preserves Unicode paths, creates nothing, and starts at the nearest existing parent of a proposed folder',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-')),folder=path.join(parent,"O'Brien & $literal (\u03bc)");await mkdir(folder);
 const proposed=path.join(folder,'not-created','workspace');assert.equal(await initialFolder(proposed),folder);
 let received;const picker=createFolderPicker({detect:async()=>backend,run:async(command,args,options)=>{received=JSON.parse(options.input);return selected(folder);}});
 assert.deepEqual(await picker.choose({initialPath:proposed}),{folder,cancelled:false});assert.equal(received.initialPath,folder);assert.deepEqual(await readdir(folder),[]);
 await assert.rejects(picker.choose({initialPath:'relative'}),{code:'STORAGE_PATH'});
 const bad=createFolderPicker({detect:async()=>backend,run:async()=>selected(path.join(folder,'missing'))});await assert.rejects(bad.choose(),{code:'STORAGE_PATH'});
 const cancel=createFolderPicker({detect:async()=>backend,run:async()=>cancelled});assert.deepEqual(await cancel.choose(),{folder:null,cancelled:true});
});

test('one native dialog can be open at a time and cancellation releases the reservation',async()=>{
 let finish,opened;const ready=new Promise(resolve=>opened=resolve);
 const picker=createFolderPicker({detect:async()=>backend,run:()=>new Promise(resolve=>{finish=resolve;opened();})});
 const first=picker.choose();await ready;await assert.rejects(picker.choose(),{code:'FOLDER_PICKER_BUSY'});finish(cancelled);await first;
 const second=picker.choose();await new Promise(resolve=>setTimeout(resolve,10));finish(cancelled);assert.equal((await second).cancelled,true);
});

test('native child lifetime is bounded and aborted requests stop it',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(runDialogProcess(process.execPath,[],{signal:controller.signal}),{code:'FOLDER_PICKER_CANCELLED'});
 const active=new AbortController();const pending=runDialogProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:active.signal});setTimeout(()=>active.abort(),100);await assert.rejects(pending,{code:'FOLDER_PICKER_CANCELLED'});
 await assert.rejects(runDialogProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100}),{code:'FOLDER_PICKER_TIMEOUT'});
 assert.equal((await runDialogProcess(process.execPath,['-e','process.stdout.write("selected path")'])).stdout,'selected path');
});

async function service(t,{protected:secure=false,picker}={}){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-picker-service-')),root=path.join(parent,'workspace');await initializeLocation(root,createNotebook('Picker test'),await createAccess(secure?'Owner':'',secure?'synthetic picker password':''));
 const app=await startServer({root,port:0,folderPicker:picker,preferencesFile:path.join(parent,'preferences.json')});t.after(()=>app.close());
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const headers={Origin:app.origin,Cookie:auth.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 return {...app,parent,root,headers,post:(route,data,extra={})=>fetch(app.origin+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)})};
}

test('native selection is authenticated and same-origin, returns only a path, and never creates or changes workspace files',async t=>{
 let calls=0;const picker={capabilities:async()=>({mode:'native',backend:'windows'}),choose:async()=>{calls++;return {folder:os.tmpdir(),cancelled:false};}};
 const app=await service(t,{picker}),before=await workspaceManifest(app.root);
 assert.equal((await app.post('/api/storage/pick',{}, {Cookie:''})).status,401);assert.equal((await app.post('/api/storage/pick',{}, {Origin:'https://untrusted.invalid'})).status,403);assert.equal(calls,0);
 const selected=await app.post('/api/storage/pick',{path:app.root});assert.equal(selected.status,200);assert.equal((await selected.json()).folder,os.tmpdir());assert.equal(calls,1);assert.deepEqual(await workspaceManifest(app.root),before);
 const locked=await service(t,{picker,protected:true});assert.equal((await locked.post('/api/storage/pick',{})).status,401);assert.equal(calls,1);
});

test('disconnecting a browser closes its pending native dialog',async t=>{
 let started,stopped;const ready=new Promise(resolve=>started=resolve),aborted=new Promise(resolve=>stopped=resolve);
 const picker={capabilities:async()=>({mode:'native',backend:'windows'}),choose:({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>{stopped();reject(new Error('aborted'));},{once:true});})};
 const app=await service(t,{picker}),controller=new AbortController();const request=fetch(app.origin+'/api/storage/pick',{method:'POST',headers:app.headers,body:'{}',signal:controller.signal});
 await ready;controller.abort();await assert.rejects(request);await Promise.race([aborted,new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Dialog remained open')),2000);timer.unref();})]);
});

test('switching workspace closes a native selection that belongs to the previous workspace',async t=>{
 let started,stopped;const ready=new Promise(resolve=>started=resolve),aborted=new Promise(resolve=>stopped=resolve);
 const picker={capabilities:async()=>({mode:'native',backend:'windows'}),choose:({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>{stopped();reject(new Error('aborted'));},{once:true});})};
 const app=await service(t,{picker}),other=path.join(app.parent,'other');await initializeLocation(other,createNotebook('Other work'),await createAccess());
 const picking=app.post('/api/storage/pick',{});await ready;
 const opened=await app.post('/api/storage/open',{path:other});assert.equal(opened.status,200);await aborted;assert.notEqual((await picking).status,200);
 assert.equal((await opened.json()).root,other);
});

test('native-created empty folders accept verified ordinary and encrypted copies; newly occupied folders are preserved',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-copy-')),source=path.join(parent,'source');await initializeLocation(source,createNotebook('Original'),await createAccess());const before=await workspaceManifest(source);
 for(const secure of [false,true]){
   const destination=path.join(parent,secure?'encrypted':'plain');await mkdir(destination);const plan=await copyPlan(source,destination);
   if(secure){const access=await createAccess('','synthetic empty folder password'),vault=takeCreatedVault(access);try{await encryptedCopy(plan,access,vault);assert.equal((await new Workspace(destination,vault).read()).book.title,'Original');}finally{clearVault(vault);}}
   else{await copyWorkspace(plan);assert.deepEqual(await workspaceManifest(destination),before);}
 }
 const occupied=path.join(parent,'became-occupied');await mkdir(occupied);const plan=await copyPlan(source,occupied);await writeFile(path.join(occupied,'retain.txt'),'untouched');
 await assert.rejects(copyWorkspace(plan),{code:'EXISTS'});assert.equal(await readFile(path.join(occupied,'retain.txt'),'utf8'),'untouched');assert.deepEqual(await readdir(occupied),['retain.txt']);assert.deepEqual(await workspaceManifest(source),before);
});
