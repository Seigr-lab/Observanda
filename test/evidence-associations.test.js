import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace,digest} from '../src/storage.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {associateOriginal} from '../src/evidence-associations.js';
import {contentBuffer} from '../src/file-content.js';
import {buildPublication} from '../src/publication.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-associations-')),book=upgradeNotebook(sampleNotebook());
 const access=await createAccess('','synthetic association password'),vault=takeCreatedVault(access),root=path.join(directory,'workspace');
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await initializeLocation(root,book,access,vault);const workspace=new Workspace(root,vault),materials=new ResearchMaterials(workspace);
 return {directory,book,workspace,materials,vault};
}
async function original(materials,recordId,bytes){
 const upload=await materials.startImport({recordId,name:'PRIVATE-disk-image.img',size:bytes.length,provenance:'Prepared disk image; acquisition notes retained verbatim.'});
 for(let i=0;i<Math.ceil(bytes.length/EVIDENCE_CHUNK);i++)await materials.appendImport(upload.id,i,[bytes.subarray(i*EVIDENCE_CHUNK,(i+1)*EVIDENCE_CHUNK)]);
 return materials.finishImport(upload.id);
}

test('one original has independent record associations, exact provenance and recoverable shared bytes',async t=>{
 const f=await fixture(t),[first,second,third]=f.book.entries,bytes=Buffer.alloc(3*EVIDENCE_CHUNK+113,0xa7);bytes.write('Synthetic disk image');
 const source=await original(f.materials,first.id,bytes),sourceDoc=await f.materials.read(source);
 const other=await associateOriginal(f.materials,{recordId:second.id,ref:source});
 const again=await associateOriginal(f.materials,{recordId:third.id,ref:other});
 assert.notEqual(other.id,source.id);assert.notEqual(again.id,other.id);
 for(const [record,ref] of [[first,source],[second,other],[third,again]]){
  const list=await f.materials.overview(record.id);assert.equal(list.items.length,1);
  assert.deepEqual(list.items[0].file,{name:'PRIVATE-disk-image.img',size:bytes.length,sha256:digest(bytes)});
  assert.deepEqual(await contentBuffer((await f.materials.artifact(ref)).content),bytes);
  assert.equal((await f.materials.read(ref)).recordId,record.id);
 }
 const attached=await f.materials.read(other);assert.deepEqual(attached.content.inputs,[source]);
 assert.deepEqual(attached.content.acquisition,sourceDoc.content.acquisition);assert.equal(attached.content.provenance,sourceDoc.content.provenance);
 assert.equal(await f.materials.artifactPath(attached),await f.materials.artifactPath(sourceDoc));
 assert.deepEqual(await readdir(await f.materials.directory('originals')),[source.id]);
 // Later source-record edits and deletion cannot rewrite acquisition meaning or
 // remove the originals associated with the surviving runs.
 const changed=await f.workspace.read();changed.book.entries=changed.book.entries.filter(r=>r.id!==first.id);await f.workspace.save(changed.book,changed.etag);
 assert.equal((await f.materials.read(attached.content.acquisition)).title,first.title);
 await f.materials.verify();
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault});
 const restored=new ResearchMaterials(new Workspace(destination,f.vault));await restored.verify();
 for(const ref of [other,again])assert.deepEqual(await contentBuffer((await restored.artifact(ref)).content),bytes);
 assert.deepEqual((await restored.overview(second.id)).items[0].file,(await f.materials.overview(second.id)).items[0].file);
 const publication=buildPublication({...changed.book,entries:changed.book.entries.map(r=>({...r,share:true}))});
 assert.ok(![...publication.files.values()].map(String).join('\n').includes('PRIVATE-disk-image.img'));
});

test('retries and concurrent attachment do not duplicate associations or move evidence',async t=>{
 const f=await fixture(t),[first,second]=f.book.entries,source=await original(f.materials,first.id,Buffer.from('Shared original'));
 const command={recordId:second.id,ref:source},attempts=await Promise.allSettled([associateOriginal(f.materials,command),associateOriginal(f.materials,command)]);
 for(const attempt of attempts)if(attempt.status==='rejected')assert.equal(attempt.reason.code,'LOCKED');
 const a=attempts.find(r=>r.status==='fulfilled').value,b=await associateOriginal(f.materials,command);
 assert.deepEqual(a,b);assert.deepEqual(await associateOriginal(f.materials,command),a);
 assert.deepEqual(await associateOriginal(f.materials,{recordId:first.id,ref:source}),source);
 assert.equal((await f.materials.list({recordId:first.id})).items.length,1);assert.equal((await f.materials.list({recordId:second.id})).items.length,1);
});

test('invalid owners, non-original sources and foreign-workspace references cannot attach evidence',async t=>{
 const f=await fixture(t),[first,second]=f.book.entries,source=await original(f.materials,first.id,Buffer.from('Original'));
 for(const command of [{recordId:randomUUID(),ref:source},{recordId:second.id,ref:{...source,kind:'record'}},{recordId:second.id,ref:{...source,workspaceId:randomUUID()}}])
  await assert.rejects(associateOriginal(f.materials,command),{code:'MATERIAL_INVALID'});
 await assert.rejects(associateOriginal(f.materials,{recordId:second.id,ref:{...source,revision:'0'.repeat(64)}}),{code:'MATERIAL_MISSING'});
 assert.equal((await f.materials.list({recordId:second.id})).items.length,0);
});
