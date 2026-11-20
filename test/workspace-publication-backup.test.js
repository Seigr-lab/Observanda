import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {MediaStore} from '../src/media.js';
import {copyPlan,copyWorkspace,inspectLocation} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {contentBuffer} from '../src/file-content.js';
import {MediaImports} from '../src/media-imports.js';
import {randomUUID} from 'node:crypto';

test('verified backups require retained original media and its display copy',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-backup-publication-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const media=new MediaStore(f.workspace.root,f.vault),original=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>');
 const asset=await media.import(original,'image'),before=await f.workspace.read();
 // A completed immediate import is accepted evidence even before placement.
 const originalFile=path.join(f.workspace.root,'.observanda/media',asset.id,'original'),ciphertext=await readFile(originalFile);await unlink(originalFile);
 try{await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'unplaced-immediate'),{vault:f.vault}),{vault:f.vault}),{code:'MATERIAL_MISSING'});}
 finally{await writeFile(originalFile,ciphertext);}
 before.book.entries[0].attachments=[{...asset,caption:'Synthetic retained figure',alt:'Green square',transcript:'',share:true}];await f.workspace.save(before.book,before.etag);
 const rendered=await media.get(asset.id,{streamed:true});
 // Media in an earlier revision remains required even after the current record
 // no longer displays it.
 const current=await f.workspace.read();current.book.entries[0].attachments=[];await f.workspace.save(current.book,current.etag);
 const files=[['original',path.join(f.workspace.root,'.observanda/media',asset.id,'original')],['display',rendered.bytes.file]];
 for(const [kind,file] of files)await t.test(kind+' missing from source',async()=>{
  const ciphertext=await readFile(file),destination=path.join(directory,'missing-'+kind);await unlink(file);
  try{await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,destination,{vault:f.vault}),{vault:f.vault}),{code:'MATERIAL_MISSING'});await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});}
  finally{await writeFile(file,ciphertext);}
 });
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'valid'),{vault:f.vault}),{vault:f.vault});
 const restored=new Workspace(destination,f.vault);
 assert.deepEqual(await restored.readFile(path.join(destination,'.observanda/media',asset.id,'original')),original);
});

test('pending media originals and their display copies participate in the restore audit',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-backup-scoped-media-')),f=await encryptedFixture(directory,sampleNotebook()),imports=new MediaImports(f.workspace);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>');
 const pending=await imports.start({name:'pending.svg',size:bytes.length,kind:'image'});await imports.receive(pending.id,[bytes]);
 const rejectMissing=async(file,label)=>{
  const ciphertext=await readFile(file),destination=path.join(directory,label);await unlink(file);
  try{await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,destination,{vault:f.vault}),{vault:f.vault}),{code:'MATERIAL_MISSING'});await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});}
  finally{await writeFile(file,ciphertext);}
 };
 await rejectMissing((await imports.original(pending.id)).content.file,'pending-original');
 const prepared=await imports.prepare(pending.id,randomUUID(),{});await f.workspace.withLock(()=>imports.commit(pending.id,prepared));
 await rejectMissing((await new MediaStore(f.workspace.root,f.vault).get(pending.id,{streamed:true})).bytes.file,'unplaced-display');
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'verified'),{vault:f.vault}),{vault:f.vault}),restored=new Workspace(destination,f.vault);
 assert.deepEqual(await contentBuffer((await new MediaImports(restored).original(pending.id)).content),bytes);
});
