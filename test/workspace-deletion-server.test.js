import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {startServer} from '../src/server.js';
import {clearVault} from '../src/encryption.js';
import {GithubConnections} from '../src/github/connections.js';
import {rememberLocation,readPreferences} from '../src/preferences.js';

test('API requires unlock, matching confirmation, current review and exclusive writer ownership',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-delete-api-')),f=await encryptedFixture(directory,sampleNotebook()),prefs=path.join(directory,'preferences.json');
 await rememberLocation(prefs,f.workspace.root,{title:'',label:'Encrypted workspace'});
 const github=new GithubConnections({file:prefs+'.github.json'}),other=path.join(directory,'other');
 await github.update(data=>{data.bindings[github.key(f.workspace.root)]={id:37,login:'tester'};data.bindings[github.key(other)]={id:37,login:'tester'};});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,preferencesFile:prefs,deviceStore:f.deviceStore,githubConnections:github});
 t.after(async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const cookie=session.headers.get('set-cookie').split(';')[0];let context;
 const request=(route,data)=>fetch(app.origin+route,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(context?{'X-Observanda-Workspace':context}:{})}});
 context=(await (await request('/api/storage')).json()).contextId;
 const review=await (await request('/api/storage/delete/preview',{})).json(),command={id:review.id,path:review.source,title:review.title,confirmed:true};
 for(const invalid of [{...command,confirmed:false},{...command,path:other},{...command,title:'wrong'}]){assert.equal((await (await request('/api/storage/delete',invalid)).json()).code,'STORAGE_DELETE_CONFIRM');await access(f.workspace.root);}
 await request('/api/access/lock',{});assert.equal((await request('/api/storage/delete',command)).status,401);
 assert.equal((await request('/api/access/unlock',{})).status,200);
 await f.workspace.update(book=>({...book,title:'More recent title'}));
 assert.equal((await (await request('/api/storage/delete',command)).json()).code,'CONFLICT');
 const next=await (await request('/api/storage/delete/preview',{})).json(),current={id:next.id,path:next.source,title:next.title,confirmed:true};
 const db=await f.workspace.openCatalogue();try{await db.run('BEGIN');await db.lock();assert.equal((await (await request('/api/storage/delete',current)).json()).code,'LOCKED');}finally{await db.close();}
 const removed=await request('/api/storage/delete',current),result=await removed.json();assert.equal(removed.status,200,JSON.stringify(result));assert.equal(result.result.complete,true);
 assert.equal((await request('/api/notebook/create',{title:'Stale tab',storagePath:f.workspace.root})).status,409);
 await assert.rejects(access(f.workspace.root),{code:'ENOENT'});assert.equal((await readPreferences(prefs)).workspace,null);
 const bindings=(await github.read()).bindings;assert.equal(bindings[github.key(f.workspace.root)],undefined);assert.deepEqual(bindings[github.key(other)],{id:37,login:'tester'});
});
