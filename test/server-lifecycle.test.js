import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Client} from 'pg';
import {testServer as startServer} from './device-fixture.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
test('authenticated readiness is redacted and shutdown drains an in-flight database save before clearing keys',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-drain-')),root=path.join(parent,'workspace'),password='synthetic lifecycle password',a=await createAccess('',password),vault=takeCreatedVault(a);
 await initializeLocation(root,sampleNotebook(),a,vault);const ws=new Workspace(root,vault),app=await startServer({root,port:0});
 t.after(async()=>{await app.close();clearVault(vault);await rm(parent,{recursive:true,force:true});});
 assert.equal(app.server.address().address,'127.0.0.1');assert.equal((await fetch(app.origin+'/api/health')).status,401);
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];
 const request=(route,data)=>fetch(app.origin+route,{headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json'},...(data?{method:'POST',body:JSON.stringify(data)}:{})});
 const health=await request('/api/health'),healthText=await health.text();assert.equal(health.status,200);assert.equal(JSON.parse(healthText).ready,true);assert.equal(healthText.includes(process.env.OBSERVANDA_DATABASE_URL),false);assert.equal(healthText.includes(root),false);
 assert.equal((await request('/api/access/unlock',{username:'',password})).status,200);
 const current=await ws.read();current.book.title='Saved during shutdown';
 let entered,release;const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),query=Client.prototype.query;
 Client.prototype.query=async function(sql,...args){const result=await query.call(this,sql,...args);if(typeof sql==='string'&&sql.startsWith('INSERT INTO snapshots')){entered();await gate;}return result;};
 try{
  const saving=request('/api/notebook/save',current);await reached;assert.equal(app.shutdownStatus().busy,true);let closed=false;const closing=app.close().then(()=>{closed=true;});
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(closed,false);release();
  assert.equal((await saving).status,200);await closing;assert.equal((await ws.read()).book.title,'Saved during shutdown');
 }finally{release();Client.prototype.query=query;}
 const restarted=await startServer({root,port:0});await restarted.close();
});
