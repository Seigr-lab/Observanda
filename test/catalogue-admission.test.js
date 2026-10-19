import {test} from 'node:test';
import assert from 'node:assert/strict';
import filesystem,{mkdtemp,mkdir,rm,rmdir,writeFile,unlink} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace,workspaceFile} from '../src/storage.js';
import {RENAME_MARKER,assertNotRenaming,renameScope} from '../src/workspace-rename-state.js';
import {DELETE_MARKER,assertNotDeleting,deletionScope} from '../src/workspace-delete-state.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
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

// Delay one filesystem probe to prove refusals drain it before disposing an
// owner. Named builtin imports must see, and then release, the scoped test mock.
function delayedStat(t,file,error){
 const original=filesystem.lstat,started=Promise.withResolvers(),finished=Promise.withResolvers();
 t.mock.method(filesystem,'lstat',async(target,...args)=>{
  if(target!==file)return original(target,...args);
  started.resolve();await finished.promise;throw error;
 });syncBuiltinESMExports();
 return {started:started.promise,release:()=>finished.resolve(),restore:()=>{filesystem.lstat.mock.restore();syncBuiltinESMExports();}};
}
async function probeFixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-admission-probes-'));
 t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-admission-probes-'));await rm(directory,{recursive:true,force:true});});
 return directory;
}

test('lifecycle probes drain concurrent reads and retain marker refusal priority', {timeout:10000},async t=>{
 const directory=await probeFixture(t),root=path.join(directory,'Owner'),parentMetadata=path.join(directory,'.observanda');
 await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(parentMetadata);
 const id=randomUUID(),cases=[
  {marker:RENAME_MARKER,check:()=>assertNotRenaming(root),scope:operation=>renameScope(id,operation),state:{version:1,id,source:root,destination:path.join(directory,'Renamed owner')},invalid:'STORAGE_RENAME_STATE',active:'STORAGE_RENAMING'},
  {marker:DELETE_MARKER,check:()=>assertNotDeleting(root),scope:operation=>deletionScope(id,operation),state:{version:1,id,source:root},invalid:'STORAGE_DELETE_STATE',active:'STORAGE_DELETING'}
 ];
 for(const item of cases){
  const marker=path.join(root,item.marker);
  for(const malformed of [true,false]){
   await writeFile(marker,malformed?'{':JSON.stringify(item.state));
   const parentError=Object.assign(new Error('Parent probe refused'),{code:'UNSAFE'}),gate=delayedStat(t,parentMetadata,parentError);let settled=false;
   const result=item.check().then(()=>{settled=true;return null;},error=>{settled=true;return error;});
   try{await gate.started;assert.equal(settled,false);gate.release();assert.equal((await result).code,malformed?item.invalid:item.active);}
   finally{gate.release();await result;gate.restore();}
  }
  await item.scope(item.check);await unlink(marker);
  await writeFile(path.join(directory,item.marker),JSON.stringify({...item.state,source:directory,...(item.marker===RENAME_MARKER?{destination:path.join(path.dirname(directory),'Renamed parent')}: {})}));
  await assert.rejects(item.check(),{code:item.active});
  await unlink(path.join(directory,item.marker));await item.check();
 }
});

test('registry admission retains key and directory refusal priority',{timeout:10000},async t=>{
 const directory=await probeFixture(t),id=randomUUID();
 for(const kind of ['project','book']){
  const root=path.join(directory,kind),metadata=path.join(root,'.observanda');await mkdir(metadata,{recursive:true});
  const keyError=Object.assign(new Error('Key refused'),{code:'ACCESS_LOCKED'});let locked=true,reads=0;
  const owner={root,...(kind==='book'?{projectId:id}:{}),requireStorageKey:async()=>{if(locked)throw keyError;},readFile:async()=>{reads++;throw new Error('Unexpected registry read');}};
  const registry=kind==='project'?new ProjectRegistry(owner,id):new LabBookRegistry(owner);
  await assert.rejects(registry.read(),error=>error===keyError);assert.equal(reads,0);locked=false;await mkdir(registry.file);
  const directoryError=Object.assign(new Error('Directory refused'),{code:'UNSAFE'}),gate=delayedStat(t,metadata,directoryError);let settled=false;
  const result=registry.read().then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  try{await gate.started;assert.equal(settled,false);gate.release();assert.equal(await result,directoryError);assert.equal(reads,0);}
  finally{gate.release();await result;gate.restore();}
  await rmdir(registry.file);assert.equal((await registry.read()).revision,'new','missing files remain permitted only after directory admission');
 }
});
