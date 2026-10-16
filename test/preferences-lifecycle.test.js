import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {defaultPreferences,preferencesSnapshot,readPreferences,rememberInterface,rememberLocation,resetPreferences} from '../src/preferences.js';
import {testServer as startServer} from './device-fixture.js';
import {initializeLocation,workspaceManifest} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {createAccess} from '../src/access.js';

async function fixture(){const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-reset-'));return {parent,root:path.join(parent,'research'),file:path.join(parent,'preferences.json')};}
async function client(app){
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 const c={context:null,request:(route,data,overrides={})=>fetch(app.origin+route,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(c.context?{'X-Observanda-Workspace':c.context}:{}),...overrides}})};
 c.context=(await (await c.request('/api/storage')).json()).contextId;return c;
}

test('reset backs up exact preferences bytes and refuses concurrent or malformed changes',async()=>{
 const {parent,root,file}=await fixture();await rememberLocation(file,root);await rememberInterface(file,{fontSize:24,lineHeight:1.9});
 const snapshot=await preferencesSnapshot(file);await rememberInterface(file,{fontSize:20,lineHeight:1.8});
 await assert.rejects(resetPreferences(file,snapshot.etag),{code:'PREFERENCES_CHANGED'});
 const current=await preferencesSnapshot(file),{workspaceDatabaseLease}=await import('../src/workspace-database-lease.js'),lease=await workspaceDatabaseLease(null,{file:file+'.lock'});
 try{await assert.rejects(resetPreferences(file,current.etag),{code:'LOCKED'});}finally{await lease.close();}
 assert.deepEqual(await readFile(file),current.raw);
 const result=await resetPreferences(file,current.etag);assert.deepEqual(await readFile(result.backup),current.raw);assert.deepEqual(await readPreferences(file),defaultPreferences());
 assert.equal((await readdir(parent)).filter(name=>name.includes('before-reset')).length,1);
 await writeFile(file,'broken preferences');await assert.rejects(resetPreferences(file,'none'),{code:'PREFERENCES_FORMAT'});assert.equal(await readFile(file,'utf8'),'broken preferences');
});

test('a detached session never implicitly selects a folder and requires a chosen location to create',async t=>{
 const {root,file}=await fixture();await initializeLocation(root,createNotebook('Existing work'),await createAccess());await rememberLocation(file,root);
 const before=await workspaceManifest(root),prefs=await readFile(file);
 const app=await startServer({root:null,port:0,preferencesFile:file});t.after(()=>app.close());const c=await client(app);
 const storage=await (await c.request('/api/storage')).json();assert.equal(storage.root,null);assert.equal(storage.expectedExisting,false);assert.ok(path.isAbsolute(storage.suggestedLocation));
 assert.deepEqual(await (await c.request('/api/notebook')).json(),{book:null});
 assert.equal((await c.request('/api/notebook/create',{title:'No location'})).status,422);
 for(const route of ['/api/notebook/save','/api/laboratory/change','/api/access/change','/api/storage/copy/preview'])assert.equal((await c.request(route,{})).status,404,route);
 assert.deepEqual(await readFile(file),prefs);assert.deepEqual(await workspaceManifest(root),before);
 const opened=await (await c.request('/api/storage/open',{path:root})).json();c.context=opened.contextId;
 assert.equal((await (await c.request('/api/notebook')).json()).book.title,path.basename(root));
});

test('reset preserves all research files, invalidates stale writes and preview URLs, and supports a fresh persisted setup',async t=>{
 const {parent,root,file}=await fixture();await initializeLocation(root,createNotebook(path.basename(root)),await createAccess());await rememberLocation(file,root);await rememberInterface(file,{fontSize:22,lineHeight:1.8});
 const before=await workspaceManifest(root),prefs=await readFile(file);
 const app=await startServer({root,port:0,preferencesFile:file,expectedExisting:true});t.after(()=>app.close());const c=await client(app),old=await client(app);
 const book=await (await c.request('/api/notebook')).json(),preview=await (await c.request('/api/design-preview',{mode:'examples',book:book.book})).json();
 const setting=await (await c.request('/api/preferences')).json();assert.equal(setting.file,file);
 assert.equal((await c.request('/api/preferences/reset',{etag:setting.etag})).status,422);
 assert.equal((await c.request('/api/preferences/reset',{etag:setting.etag,confirmed:true},{Origin:'https://foreign.invalid'})).status,403);
 assert.equal((await fetch(app.origin+'/api/preferences/reset',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({etag:setting.etag,confirmed:true})})).status,401);
 assert.equal((await c.request('/api/preferences/reset',{etag:'old',confirmed:true})).status,409);
 const response=await c.request('/api/preferences/reset',{etag:setting.etag,confirmed:true});assert.equal(response.status,200);const reset=await response.json();c.context=reset.storage.contextId;
 assert.equal(reset.storage.root,null);assert.deepEqual(await readFile(reset.backup),prefs);assert.deepEqual(await workspaceManifest(root),before);assert.deepEqual(await readPreferences(file),defaultPreferences());
 assert.equal((await old.request('/api/notebook/save',book)).status,409);assert.equal((await old.request('/api/interface',{fontSize:20,lineHeight:1.8})).status,409);
 assert.ok(preview.url);assert.equal((await c.request(preview.url)).status,404);
 assert.deepEqual(await (await c.request('/api/notebook')).json(),{book:null});
 const destination=path.join(parent,'New work');const created=await c.request('/api/notebook/create',{title:'New work',storagePath:destination});assert.equal(created.status,201);c.context=(await created.json()).storage.contextId;
 const preferences=await readPreferences(file);assert.equal(preferences.workspace,destination);assert.deepEqual(preferences.recent.map(item=>item.path),[destination]);assert.deepEqual(await workspaceManifest(root),before);
 const restarted=await startServer({root:preferences.workspace,port:0,preferencesFile:file,expectedExisting:true});t.after(()=>restarted.close());const next=await client(restarted);assert.equal((await (await next.request('/api/notebook')).json()).book.title,'New work');
});

test('locked workspaces reject preference reset without modifying protection or stored settings',async t=>{
 const {root,file}=await fixture();await initializeLocation(root,createNotebook('Protected'),await createAccess('Owner','synthetic protected password'));await rememberLocation(file,root);
 const before=await workspaceManifest(root),prefs=await preferencesSnapshot(file);const app=await startServer({root,port:0,preferencesFile:file});t.after(()=>app.close());const c=await client(app);
 assert.equal((await c.request('/api/preferences/reset',{etag:prefs.etag,confirmed:true})).status,401);assert.deepEqual(await readFile(file),prefs.raw);assert.deepEqual(await workspaceManifest(root),before);
});

async function launchCLI(t,file,args=[]){
 const child=spawn(process.execPath,['src/cli.js','open','--no-browser','--port','0','--preferences',file,...args],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}});
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('CLI startup timed out')),15000);timer.unref();child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/);if(match){clearTimeout(timer);resolve(match[0]);}});child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);reject(new Error('CLI exited before ready: '+code));});});
 return {origin:new URL(url).origin,launchToken:new URL(url).hash.slice(1)};
}

test('CLI --setup bypasses remembered work without rewriting preferences; reset remains fresh across a normal launch',async t=>{
 const {root,file}=await fixture();await initializeLocation(root,createNotebook('Retained'),await createAccess());await rememberLocation(file,root);const before=await preferencesSnapshot(file),manifest=await workspaceManifest(root);
 const forced=await launchCLI(t,file,['--setup']),c=await client(forced);assert.deepEqual(await (await c.request('/api/notebook')).json(),{book:null});assert.deepEqual(await readFile(file),before.raw);
 await resetPreferences(file,before.etag);const resetBytes=await readFile(file);const normal=await launchCLI(t,file),fresh=await client(normal);
 assert.deepEqual(await (await fresh.request('/api/notebook')).json(),{book:null});assert.equal((await (await fresh.request('/api/storage')).json()).root,null);
 assert.deepEqual(await readFile(file),resetBytes);assert.deepEqual(await workspaceManifest(root),manifest);
});

test('language changes are authenticated, origin checked and independent of locked research',async t=>{
 const {root,file}=await fixture();
 await initializeLocation(root,createNotebook('Locked research'),await createAccess('Owner','synthetic language password'));await rememberLocation(file,root);
 const before=await workspaceManifest(root),app=await startServer({root,port:0,preferencesFile:file});t.after(()=>app.close());
 const c=await client(app);
 assert.equal((await fetch(app.origin+'/api/language')).status,401);
 assert.equal((await c.request('/api/language',{language:'nn'},{Origin:'https://foreign.invalid'})).status,403);
 assert.equal((await c.request('/api/language',{language:'nn',workspace:'unexpected'})).status,422);
 assert.equal((await c.request('/api/language',{language:'../../vault'})).status,422);
 const changed=await c.request('/api/language',{language:'nn'});assert.equal(changed.status,200);
 assert.deepEqual(await changed.json(),{language:'nn'});assert.equal((await readPreferences(file)).language,'nn');
 assert.deepEqual(await workspaceManifest(root),before);assert.equal((await c.request('/api/notebook')).status,401);
 const doc=await fetch(app.origin+'/locales/nn/guide.json');assert.equal(doc.status,200);assert.match(doc.headers.get('content-type'),/application\/json/);assert.ok((await doc.json()).topics.length>0);
});
