import {withOperationProgress} from '../src/operation-progress.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,unlink,rename,lstat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {initializeLocation,copyPlan,copyWorkspace,inspectLocation} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {contentBuffer} from '../src/file-content.js';

test('a verified backup requires the recorded evidence bytes and received upload chunks',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-backup-evidence-')),root=path.join(directory,'source');
 const access=await createAccess('','synthetic evidence integrity'),vault=takeCreatedVault(access),book=sampleNotebook();
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 await initializeLocation(root,book,access,vault);
 const workspace=new Workspace(root,vault),materials=new ResearchMaterials(workspace),bytes=Buffer.alloc(1024*1024,0xa7);
 const session=await materials.startImport({recordId:book.entries[0].id,name:'original.bin',size:bytes.length});
 await materials.appendImport(session.id,0,[bytes]);const artifact=await materials.finishImport(session.id),original=(await materials.artifact(artifact)).content.file;
 // Exactly one file-authentication pass for each original, even when the
 // descriptor is reached through several retained material references.
 const samples=[];await withOperationProgress(value=>samples.push(value),()=>workspace.catalogue(()=>materials.verifySnapshot({readOnly:true})));
 assert.ok(samples.at(-1).activity.bytes>=bytes.length);
 assert.ok(samples.at(-1).activity.bytes<bytes.length*1.1,'Verification reread the full original beyond its metadata budget');
 const pending=await materials.startImport({recordId:book.entries[0].id,name:'pending.bin',size:bytes.length});
 await materials.appendImport(pending.id,0,[bytes]);const chunk=path.join(root,'.observanda/materials/imports',pending.id,'0.chunk');
 const before=await workspace.read();
 for(const [kind,file] of [['original',original],['chunk',chunk]]){
  const ciphertext=await readFile(file);
  for(const damage of ['missing','corrupted','substituted']){
   const destination=path.join(directory,kind+'-'+damage);
   if(damage==='missing')await unlink(file);
   else if(damage==='corrupted'){const changed=Buffer.from(ciphertext);changed[changed.length-1]^=1;await writeFile(file,changed);}
   else await workspace.writeFile(file,Buffer.alloc(bytes.length,0x3f));
   await assert.rejects(copyWorkspace(await copyPlan(root,destination),{vault}),error=>['MATERIAL_MISSING','ENCRYPTION_DAMAGED'].includes(error.code));
   await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});
   assert.deepEqual(await workspace.read(),before);
   await writeFile(file,ciphertext);
  }
 }
 // A failed read-only audit must not recreate missing evidence directories.
 for(const file of [original,chunk]){
  const folder=path.dirname(file),held=path.join(directory,'held-evidence');await rename(folder,held);
  try{
   await assert.rejects(workspace.catalogue(()=>materials.verifySnapshot({readOnly:true})),{code:'MATERIAL_MISSING'});
   await assert.rejects(lstat(folder),{code:'ENOENT'});
  }finally{await rename(held,folder);}
 }
 const destination=await copyWorkspace(await copyPlan(root,path.join(directory,'verified')),{vault});
 const restored=new ResearchMaterials(new Workspace(destination,vault));
 assert.deepEqual(await contentBuffer((await restored.artifact(artifact)).content),bytes);
 assert.equal(restored.uploads.count(await restored.importState(pending.id)),1);
 assert.deepEqual(await workspace.read(),before);
});
