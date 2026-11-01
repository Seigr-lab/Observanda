import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer} from './device-fixture.js';

test('expired browser bearers cannot enter exceptional routes, download grants or launch replay',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-session-expiry-')),app=await testServer({port:0,headless:true,preferencesFile:path.join(root,'preferences')});
 t.after(async()=>{await app.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-session-expiry-'));await rm(root,{recursive:true,force:true});});
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const launch=app.launchToken,binding='d'.repeat(64),login=token=>fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token,binding})});
 const first=await login(launch);assert.equal(first.status,200);const token=(await first.json()).session;
 const headers={Origin:app.origin,'Content-Type':'application/json','X-Observanda-Session':token};
 const grant=await fetch(app.origin+'/api/session/download',{method:'POST',headers,body:JSON.stringify({url:'/api/access/status'})});assert.equal(grant.status,200);const target=(await grant.json()).url;
 now+=8*60*60*1000;
 for(const route of ['preview','unlock','confirm','cancel','finish']){
  // Invalid JSON would fail body parsing if route dispatch happened first.
  const response=await fetch(app.origin+'/api/workspaces/delete/'+route,{method:'POST',headers,body:'not JSON'});assert.equal(response.status,401,route);assert.equal((await response.json()).code,'AUTH');
 }
 for(const route of ['/api/access/status','/api/preferences','/api/health','/api/workspaces']){
  const response=await fetch(app.origin+route,{headers});assert.equal(response.status,401,route);await response.json();
 }
 assert.equal((await fetch(app.origin+target)).status,401);
 assert.equal((await login(launch)).status,401);
 const fresh=await login(app.launchToken);assert.equal(fresh.status,200);const freshToken=(await fresh.json()).session;assert.notEqual(freshToken,token);
 const healthy=await fetch(app.origin+'/api/access/status',{headers:{'X-Observanda-Session':freshToken}});assert.equal(healthy.status,200);await healthy.json();
 now-=8*60*60*1000;
 assert.equal((await fetch(app.origin+'/api/access/status',{headers})).status,401,'Removed expired entries cannot revive after a wall-clock rollback');
});
