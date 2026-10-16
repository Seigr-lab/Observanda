import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {withProjectLifecycle} from '../src/project-lifecycle.js';
import {Workspace} from '../src/storage.js';
import {setTimeout as delay} from 'node:timers/promises';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-project-lifecycle-'));await mkdir(path.join(root,'.observanda'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-project-lifecycle-'));await rm(root,{recursive:true,force:true});});return {workspace:new Workspace(root)};}
test('same-project lifecycle commands serialize while another project proceeds',async t=>{
 const registry=await fixture(t),a=randomUUID(),b=randomUUID();let release,started,second=false;const held=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 const first=withProjectLifecycle(registry,a,'copy',async()=>{started();await held;});await entered;
 const next=withProjectLifecycle(registry,a,'move',async()=>{second=true;});await delay(30);assert.equal(second,false);
 assert.equal(await withProjectLifecycle(registry,b,'move',async()=>42),42);release();await Promise.all([first,next]);assert.equal(second,true);
});
test('interrupted ownership command blocks other lifecycle kinds until its receipt completes',async t=>{
 const registry=await fixture(t),id=randomUUID(),file=path.join(registry.workspace.root,'.observanda/project-copies',id+'.obsv');await mkdir(path.dirname(file));
 await writeFile(file,JSON.stringify({version:1,projectId:id,id:randomUUID(),phase:'copying'}));
 await assert.rejects(withProjectLifecycle(registry,id,'move',async()=>assert.fail('Must not start')),{code:'STORAGE_PROJECT_BUSY'});
 assert.equal(await withProjectLifecycle(registry,id,'copy',async()=>true),true);
 await writeFile(file,JSON.stringify({version:1,projectId:id,id:randomUUID(),phase:'complete'}));assert.equal(await withProjectLifecycle(registry,id,'move',async()=>true),true);
 await writeFile(file,JSON.stringify({version:1,projectId:randomUUID(),id:randomUUID(),phase:'complete'}));await assert.rejects(withProjectLifecycle(registry,id,'move',async()=>true),{code:'STORAGE_PROJECT_BUSY'});
});
