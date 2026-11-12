import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';

// Converting an existing website on first open must cost a bounded amount of storage work per shared
// entry: no website storage scope or catalogue transaction per entry or per edition file.
const nesting=new AsyncLocalStorage();
function count(target,name,counter){
 const original=target.prototype[name];
 target.prototype[name]=function(...args){if(nesting.getStore()?.has(name))return original.apply(this,args);counter[name]++;return nesting.run(new Set([...(nesting.getStore()??[]),name]),()=>original.apply(this,args));};
 return ()=>{target.prototype[name]=original;};
}
async function convert(t,records){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-upgrade-cost-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:records},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Study '+i,body:'Shared notes '+i,sections:[],attachments:[],figures:[],relations:[],contributors:[]}));
 const f=await encryptedFixture(directory,book),counter={scope:0,catalogue:0};
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const restore=[count(WebsiteFileStore,'scope',counter),count(Workspace,'catalogue',counter)];
 t.after(async()=>{for(const undo of restore)undo();await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('x-observanda-session').split(';')[0];
 const started=performance.now(),storage=await (await fetch(app.origin+'/api/storage',{headers:{'X-Observanda-Session':cookie}})).json();
 for(;;){
  const {preparation}=await (await fetch(app.origin+'/api/website-files/preparation',{method:'POST',headers:{Origin:app.origin,'X-Observanda-Session':cookie,'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:'{}'})).json();
  assert.notEqual(preparation.state,'failed',JSON.stringify(preparation));
  if(preparation.state==='ready'&&preparation.library?.state!=='preparing')break;
  await delay(250);
 }
 const result={records,...counter,ms:Math.round(performance.now()-started)};
 for(const undo of restore)undo();restore.length=0;t.diagnostic(JSON.stringify(result));return result;
}
test('converting an existing website costs bounded storage work per shared entry',{timeout:900000},async t=>{
 const small=await convert(t,42),large=await convert(t,200),grown=large.records-small.records;
 // Measured 2026-11-12: website storage scopes grew 0.25 per added entry (1.83 before grouping);
 // catalogue transactions 5.9 per added entry. The bounds keep both from regressing.
 for(const [name,bound] of [['scope',0.5],['catalogue',7]])assert.ok((large[name]-small[name])/grown<=bound,name+': '+JSON.stringify({small,large}));
});
