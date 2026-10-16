import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace,workspaceManifest} from '../src/locations.js';
import {workspaceInventory,workspaceFiles} from '../src/workspace-inventory.js';
import {databaseCapacity} from '../src/postgres.js';

test('copy reviews retain constant-size receipts at 65 and 650 files and replay the exact inventory',async t=>{
 t.diagnostic(os.platform()+'/'+os.arch()+'; '+os.cpus()[0].model+'; Node '+process.version);
 for(const count of [65,650]){
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-')),destination=path.join(directory,'copy');
  const {workspace,vault}=await encryptedFixture(path.join(directory,'source'),sampleNotebook());const root=workspace.root;
  t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
  const folder=path.join(root,'.observanda','fixture');await mkdir(folder);
  for(let i=0;i<count;i++)await workspace.writeFile(path.join(folder,String(i).padStart(4,'0')+'.bin'),Buffer.from('Synthetic capture '+i));
  const start=performance.now(),plan=await copyPlan(root,destination);
  assert.equal(plan.files,undefined);assert.ok(Buffer.byteLength(JSON.stringify(plan))<1024);
  assert.ok(plan.fileCount>=count);const second=await workspaceInventory(root,plan.inventorySalt);
  assert.equal(plan.fingerprint,second.fingerprint);assert.equal(plan.fileCount,second.fileCount);
  const walked=[];for await(const file of workspaceFiles(root))walked.push(file.path);
  assert.equal(new Set(walked).size,plan.fileCount);
  t.diagnostic(count+' originals: '+Math.round(performance.now()-start)+' ms for review, repeat inventory and traversal; receipt '+Buffer.byteLength(JSON.stringify(plan))+' bytes; '+plan.fileCount+' total files.');
  await copyWorkspace(plan,{vault});
  for(const n of [0,count-1])assert.deepEqual(await readFile(path.join(destination,'.observanda','fixture',String(n).padStart(4,'0')+'.bin')),await readFile(path.join(folder,String(n).padStart(4,'0')+'.bin')));
 }
});

test('inventory cancellation closes scratch work; equal-size substitutions invalidate review before copying',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-conflict-'));
 const {workspace,vault}=await encryptedFixture(path.join(directory,'source'),sampleNotebook());const root=workspace.root;t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 const file=path.join(root,'.observanda','fixture');await writeFile(file,'First');
 const initial=databaseCapacity().active,controller=new AbortController();
 await assert.rejects(workspaceInventory(root,randomUUID(),{signal:controller.signal,visit:()=>controller.abort()}),{name:'AbortError'});
 assert.equal(databaseCapacity().active,initial);
 const plan=await copyPlan(root,path.join(directory,'copy'));await writeFile(file,'Later');
 await assert.rejects(copyWorkspace(plan,{vault}),{code:'CONFLICT'});
 await assert.rejects(readFile(path.join(plan.destination,'workspace.observanda')),{code:'ENOENT'});
 const before=await workspaceManifest(root);
 await assert.rejects(copyWorkspace({...await copyPlan(root,path.join(directory,'other')),fileCount:0},{vault}),{code:'CONFLICT'});
 assert.deepEqual(await workspaceManifest(root),before);
});
