import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';

test('copy progress measures files, archive rows and verified revisions while preserving copied research',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-progress-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const file=path.join(f.workspace.root,'.observanda','copy-progress-evidence');await f.workspace.writeFile(file,Buffer.alloc(3*1024*1024,19));const fileBytes=(await readFile(file)).length;
 const planEvents=[],events=[],plan=await copyPlan(f.workspace.root,path.join(directory,'copy'),{onProgress:e=>planEvents.push(e)});
 assert.ok(planEvents.some(e=>e.stage==='database-inventory'&&e.completed>0));
 const before=await f.workspace.read(),copy=await copyWorkspace(plan,{vault:f.vault,onProgress:e=>events.push(e)});
 assert.deepEqual(await new Workspace(copy,f.vault).read(),before);assert.deepEqual(await readFile(path.join(copy,'.observanda','copy-progress-evidence')),await readFile(file));
 const bytes=events.findLast(e=>e.stage==='copy-file'&&e.item==='.observanda/copy-progress-evidence');assert.equal(bytes.completed,fileBytes);assert.equal(bytes.total,bytes.completed);
 for(const stage of ['archive-table','verify-snapshots','verify-history']){
  const completed=events.filter(e=>e.stage===stage&&e.total>0&&e.completed===e.total);assert.ok(completed.length,stage);
 }
 for(const stage of ['verify-evidence','verify-publication','verify-collaboration'])assert.ok(events.some(e=>e.stage===stage),stage);
 assert.ok(events.some(e=>e.stage==='verify-snapshots'&&e.activity.objects>0));
 const next=await createAccess('','fresh synthetic progress password'),vault=takeCreatedVault(next);t.after(()=>clearVault(vault));const rekey=[];
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),next,vault,f.vault,{onProgress:e=>rekey.push(e)});
 assert.deepEqual((await new Workspace(fresh,vault).read()).book,before.book);assert.ok(rekey.some(e=>e.stage==='rekey-table'&&e.completed>0));
});
