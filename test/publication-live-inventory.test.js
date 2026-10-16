import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LivePathIndex,deploymentInventory,deploymentInventoryPaths,prepareDeploymentInventory,recordDeploymentInventory,verifyDeploymentInventories} from '../src/publication-live-inventory.js';
import {digest,serialize} from '../src/storage-format.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {randomUUID} from 'node:crypto';

test('retained live inventories grow past their former envelope and seek directly to late paths',async t=>{
 const data=new Map();let reads=0,largest=0;
 const workspace={async readMetadata(name,limit){reads++;const value=data.get(name)??null;if(value!==null)assert.ok(Buffer.byteLength(value)<=limit);return value;},async writeMetadata(name,value){largest=Math.max(largest,Buffer.byteLength(value));data.set(name,value);}};
 const store=new LivePathIndex(workspace,{write:fn=>fn()}),builder=store.builder(),count=25017,name=i=>'pages/'+String(i).padStart(8,'0')+'-'+('long-path-'.repeat(70))+'.html';
 const started=Date.now();for(let i=0;i<count;i++){await builder.add(name(i));if(i%1000===0)await builder.add(name(i));}const root=await builder.finish();
 assert.ok(count*name(0).length>16*1024*1024);assert.equal(root.root.count,count);assert.ok(largest<262144);assert.ok(serialize(root).length<4096);
 reads=0;const fresh=new LivePathIndex(workspace,{write:fn=>fn()}),late=await fresh.page(root,{offset:25000});
 assert.equal(late.total,count);assert.equal(late.paths.length,17);assert.equal(late.paths[0],name(25000));assert.equal(late.next,null);assert.ok(reads<10,reads+' metadata reads');
 let seen=0;for await(const value of fresh.paths(root))assert.equal(value,name(seen++));assert.equal(seen,count);
 t.diagnostic(JSON.stringify({paths:count,largestPage:largest,headerBytes:serialize(root).length,elapsedMs:Date.now()-started}));
});

test('inventory preparation preserves removals, fences changes and survives fresh-key recovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-live-inventory-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const {workspace}=f,key=digest('destination'),file='.observanda/publication-live/'+key+'.json',firstReceipt={commit:'a'.repeat(40),releaseId:'old-edition'},receipt={commit:'b'.repeat(40),releaseId:'new-edition'};
 const legacy={version:1,...firstReceipt,files:['publication.json','old.html','kept.html'],removed:['older.html']};await workspace.withLock(()=>workspace.writeMetadata(file,serialize(legacy)));
 let steps=0;await assert.rejects(prepareDeploymentInventory(workspace,key,Array.from({length:100},(_,i)=>i+'.html'),{guard:async()=>{if(++steps===3)throw Error('Synthetic interruption');}}),/Synthetic interruption/);
 assert.deepEqual(await deploymentInventory(workspace,key),legacy);
 const files=['publication.json','kept.html',...Array.from({length:1003},(_,i)=>'pages/'+i+'.html')],prepared=await prepareDeploymentInventory(workspace,key,files,{removed:['remote-retired.html']});
 assert.deepEqual(await deploymentInventory(workspace,key),legacy,'preparation does not publish a receipt');
 await workspace.withLock(()=>recordDeploymentInventory(workspace,key,receipt,prepared));
 const stored=await deploymentInventory(workspace,key);assert.equal(stored.version,2);assert.ok(Buffer.byteLength(serialize(stored))<4096);
 assert.deepEqual(await Array.fromAsync(deploymentInventoryPaths(workspace,stored,'removed')),['old.html','older.html','remote-retired.html']);
 await workspace.withLock(()=>recordDeploymentInventory(workspace,key,receipt,prepared));
 const stale=await prepareDeploymentInventory(workspace,key,['publication.json','another.html']),next=await prepareDeploymentInventory(workspace,key,[...files,'older.html']);
 const latest={commit:'c'.repeat(40),releaseId:'next-edition'};await workspace.withLock(()=>recordDeploymentInventory(workspace,key,latest,next));
 await assert.rejects(workspace.withLock(()=>recordDeploymentInventory(workspace,key,{commit:'d'.repeat(40),releaseId:'stale'},stale)),{code:'PUBLISH_STALE'});
 const current=await deploymentInventory(workspace,key);assert.deepEqual(await Array.fromAsync(deploymentInventoryPaths(workspace,current,'removed')),['old.html','remote-retired.html']);
 const scoped=websiteWorkspace(workspace,randomUUID());assert.equal(await deploymentInventory(scoped,key),null);
 const site=await prepareDeploymentInventory(scoped,key,['publication.json','site.html']);
 await scoped.withLock(()=>recordDeploymentInventory(scoped,key,{commit:'site-commit',releaseId:'site-edition'},site));
 assert.equal((await deploymentInventory(workspace,key)).commit,latest.commit);await verifyDeploymentInventories(workspace);await verifyDeploymentInventories(scoped);
 const pendingFile='.observanda/deployments/'+randomUUID()+'.json',pendingNode='.observanda/materials/sequences/live-inventory-nodes/'+stale.files.root.hash+'.json';
 const pendingBytes=await workspace.readMetadata(pendingNode,262144);
 await workspace.withLock(async()=>{await workspace.writeMetadata(pendingFile,serialize({version:1,journal:{liveInventory:stale}}));await workspace.writeMetadata(pendingNode,'{}');});
 await assert.rejects(verifyDeploymentInventories(workspace),{code:'MATERIAL_MISSING'});
 await workspace.withLock(async()=>{await workspace.writeMetadata(pendingNode,pendingBytes);await workspace.removeMetadata(pendingFile);});
 const access=await createAccess('','synthetic inventory recovery'),vault=takeCreatedVault(access);
 try{
  const destination=await encryptedCopy(await copyPlan(workspace.root,path.join(directory,'restored')),access,vault,f.vault),restored=new Workspace(destination,vault);
  assert.deepEqual(await deploymentInventory(restored,key),current);await verifyDeploymentInventories(restored);
  assert.deepEqual(await Array.fromAsync(deploymentInventoryPaths(restored,current,'files')),[...files,'older.html'].sort());
  const node='.observanda/materials/sequences/live-inventory-nodes/'+current.files.root.hash+'.json';await workspace.withLock(()=>workspace.writeMetadata(node,'{}'));
  await assert.rejects(encryptedCopy(await copyPlan(workspace.root,path.join(directory,'damaged')),access,vault,f.vault),{code:'MATERIAL_MISSING'});
 }finally{clearVault(vault);}
});
