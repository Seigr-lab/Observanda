import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace,workspaceFile} from '../src/storage.js';
import {RENAME_MARKER} from '../src/workspace-rename-state.js';
import {clearVault,cloneVault} from '../src/encryption.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-catalogue-admission-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-catalogue-admission-'));await rm(directory,{recursive:true,force:true});});return f;
}

test('metadata reuses admitted transactions while raw files and fresh readers honor relocation fences',async t=>{
 const f=await fixture(t),ws=f.workspace,relative='.observanda/qualification/item.json',marker=path.join(ws.root,RENAME_MARKER),file=await workspaceFile(ws.root);
 await ws.withLock(()=>ws.writeMetadata(relative,'retained'));
 const requireKey=ws.requireStorageKey.bind(ws);let checks=0;
 ws.requireStorageKey=async()=>{checks++;return requireKey();};
 await ws.catalogue(async()=>{
  const admitted=checks;assert.ok(admitted>0);
  for(let i=0;i<20;i++){
   assert.equal(await ws.readMetadata(relative,1024),'retained');
   assert.deepEqual(await ws.listMetadata('.observanda/qualification'),['item.json']);
   assert.equal((await ws.metadataPage('.observanda/qualification')).items[0].text,'retained');
  }
  assert.equal(checks,admitted,'metadata must not repeat filesystem admission within its snapshot');
  await writeFile(marker,JSON.stringify({version:1,id:randomUUID(),source:ws.root,destination:path.join(path.dirname(ws.root),'Renamed workspace')}));
  assert.equal(await ws.readMetadata(relative,1024),'retained');
  await assert.rejects(ws.readFile(file),{code:'STORAGE_RENAMING'});
 });
 await assert.rejects(ws.readMetadata(relative,1024),{code:'STORAGE_RENAMING'});
 await assert.rejects(ws.withLock(()=>ws.writeMetadata(relative,'changed')),{code:'STORAGE_RENAMING'});
 await unlink(marker);assert.equal(await ws.readMetadata(relative,1024),'retained');
});

test('admitted metadata never lends its identity or retained key to another owner',async t=>{
 const f=await fixture(t),ws=f.workspace,relative='.observanda/qualification/item.json';
 await ws.withLock(()=>ws.writeMetadata(relative,'retained'));
 const key=Buffer.from(f.vault.key),other=cloneVault(f.vault);other.key[0]^=255;
 try{await ws.catalogue(async()=>{
  await assert.rejects(new Workspace(ws.root,other).readMetadata(relative,1024),{code:'ACCESS_DENIED'});
  const wrongProject=new Workspace(ws.root,f.vault);wrongProject.projectId=randomUUID();
  await assert.rejects(wrongProject.readMetadata(relative,1024),{code:'DATABASE_LOCATION'});
  clearVault(f.vault);await assert.rejects(ws.readMetadata(relative,1024),{code:'ACCESS_LOCKED'});
 });}finally{f.vault.key=key;clearVault(other);}
 assert.equal(await ws.readMetadata(relative,1024),'retained');
});
