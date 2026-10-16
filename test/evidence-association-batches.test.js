import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {contentBuffer} from '../src/file-content.js';

async function fixture(t,count=67){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-batches-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const m=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book,[first,second]=book.entries,refs=[],bytes=[];
 for(let i=0;i<count;i++){
  const buffer=Buffer.from('Original preparation file '+i),upload=await m.startImport({recordId:first.id,name:'preparation-'+i+'.bin',size:buffer.length,provenance:'Acquired once'});
  await m.appendImport(upload.id,0,[buffer]);refs.push(await m.finishImport(upload.id));bytes.push(buffer);
 }
 let selection={recordId:second.id,kind:'artifact',selection:null,count:0};
 for(let i=0;i<refs.length;i+=20)selection={...selection,...await m.choices.change({...selection,refs:refs.slice(i,i+20),checked:true})};
 return {...f,directory,m,first,second,refs,bytes,selection};
}

test('file sets resume after lost replies and backup restore with every association and original intact',async t=>{
 const f=await fixture(t),command={...f.selection,id:randomUUID()},initial=await f.m.associations.start(command);
 assert.deepEqual(await f.m.associations.start(command),initial);
 assert.equal((await f.m.associations.step(initial.id)).attached,32);
 // The caller lost this response. Reopening reads the committed receipt.
 const m=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));
 assert.equal((await m.associations.list({recordId:f.second.id})).items[0].attached,32);
 await m.verify();
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault});
 const restored=new ResearchMaterials(new Workspace(backup,f.vault));
 assert.equal((await restored.associations.step(initial.id)).attached,64);
 const completed=await restored.associations.step(initial.id);assert.equal(completed.state,'completed');assert.equal(completed.attached,67);
 assert.deepEqual(await restored.associations.step(initial.id),completed);
 assert.deepEqual((await restored.associations.list({recordId:f.second.id})).items,[]);
 const batch=await restored.associations.read(initial.id),results=[];
 for await(const ref of restored.sequences.items(batch.results))results.push(ref);
 for(const [i,ref] of results.entries()){
  const doc=await restored.read(ref),source=await restored.read(f.refs[i]);
  assert.equal(doc.recordId,f.second.id);assert.deepEqual(doc.content.inputs,[f.refs[i]]);
  assert.deepEqual(doc.content.acquisition,source.content.acquisition);assert.equal(doc.content.sha256,source.content.sha256);
  assert.deepEqual(await contentBuffer((await restored.artifact(ref)).content),f.bytes[i]);
 }
 assert.equal((await readdir(await restored.directory('originals'))).length,67);
 // Another batch using the same immutable selection also reuses associations.
 const retry=await restored.associations.start({...command,id:randomUUID()});
 while((await restored.associations.step(retry.id)).state==='open'){}
 assert.deepEqual((await restored.sequences.page((await restored.associations.read(retry.id)).results,{limit:67})).items,results);
 // Retention and recovery remain valid even when the old acquiring record and
 // the associated record have both been removed from the current notebook.
 const saved=await restored.workspace.read();saved.book.entries=saved.book.entries.filter(r=>![f.first.id,f.second.id].includes(r.id));
 await restored.workspace.save(saved.book,saved.etag);await restored.verify();
 await assert.rejects(restored.associations.step(initial.id),{code:'MATERIAL_INVALID'});
});

test('a failed batch rolls back all associations and progress, and cancellation retains committed files',async t=>{
 const f=await fixture(t,35),batch=await f.m.associations.start(f.selection),commit=f.m.commit;let calls=0;
 f.m.commit=async function(command){const result=await commit.call(this,command);if(++calls===7)throw Object.assign(Error('Synthetic full volume'),{code:'ENOSPC'});return result;};
 try{await assert.rejects(f.m.associations.step(batch.id),{code:'ENOSPC'});}finally{f.m.commit=commit;}
 assert.equal((await f.m.associations.read(batch.id)).results.count,0);
 assert.equal((await f.m.list({recordId:f.second.id})).items.length,0);
 assert.equal((await f.m.associations.step(batch.id)).attached,32);
 const cancelled=await f.m.associations.cancel(batch.id);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.attached,32);
 assert.deepEqual(await f.m.associations.step(batch.id),cancelled);await f.m.verify();
 assert.deepEqual((await f.m.associations.list({recordId:f.second.id})).items,[]);
});

test('batch selections reject wrong owners, counts, kinds, tampering and partial selection edits',async t=>{
 const f=await fixture(t,2),command={...f.selection,id:randomUUID()};
 await assert.rejects(f.m.associations.start({...command,count:3}),{code:'MATERIAL_CHANGED'});
 await assert.rejects(f.m.associations.start({...command,recordId:f.first.id}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.associations.start({...command,selection:'damaged'}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.choices.change({...f.selection,refs:[f.refs[0],{...f.refs[1],workspaceId:randomUUID()}],checked:false}),{code:'MATERIAL_INVALID'});
 assert.equal((await f.m.choices.page(f.selection)).items.length,2);
 const collection=await f.m.collection({recordId:f.second.id,title:'Not an original',inputs:[]});
 await assert.rejects(f.m.choices.change({...f.selection,refs:[collection],checked:true}),{code:'MATERIAL_INVALID'});
 const initial=await f.m.associations.start(command);
 const changed=await f.m.choices.change({...f.selection,ref:f.refs[0],checked:false});
 await assert.rejects(f.m.associations.start({...command,...changed}),{code:'MATERIAL_CHANGED'});
 assert.equal((await f.m.associations.step(initial.id)).attached,2);
 await f.workspace.withLock(()=>f.workspace.removeMetadata('.observanda/materials/objects/'+f.refs[0].id+'/'+f.refs[0].revision+'.json'));
 await assert.rejects(f.m.verify());
});

test('a fresh-key successor retains unfinished selections without depending on the previous vault key',async t=>{
 const f=await fixture(t,2),batch=await f.m.associations.start(f.selection);
 const access=await createAccess('','synthetic new attachment key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const copy=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh-key')),access,vault,f.vault),restored=new ResearchMaterials(new Workspace(copy,vault));
 assert.equal((await restored.associations.list({recordId:f.second.id})).items[0].id,batch.id);
 assert.equal((await restored.associations.step(batch.id)).attached,2);await restored.verify();
 assert.equal((await f.m.associations.read(batch.id)).results.count,0);
});
