import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords} from '../src/research.js';
import {appearancePreviewPage} from '../src/appearance-preview.js';
import {renderPublication} from '../src/publication.js';
import {digest,serialize} from '../src/storage-format.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';

test('older preview backlink discovery retains only related public descriptors as the corpus grows',async t=>{
 for(const {count,missingReferences=false} of [{count:20},{count:200},{count:20,missingReferences:true}]){
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-legacy-preview-links-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];book.entries=[];
  const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  const records=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Visible observation '+i,body:'Original observation '+i+' '+'.'.repeat(4000),share:true,sections:[],attachments:[],figures:[],relations:[]}));
  const target=records[count/2],related=records[0],privateRecord=records.at(-1);
  const link=()=>({id:randomUUID(),type:'Related observation',target:{workspaceId:book.id,kind:'record',id:target.id},label:target.title});
  related.relations=[link()];privateRecord.relations=[link()];privateRecord.share=false;privateRecord.title='PRIVATE BACKLINK';
  const service=new ResearchRecords(f.workspace,{});
  for(let offset=0;offset<count;offset+=40)await service.save({workspaceId:book.id,changes:records.slice(offset,offset+40).map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});
  const etag=(await f.workspace.outline()).etag;
  await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
   const manifest=await store.manifest();
   for(const row of manifest.records){
    const slot='record-summary:'+row.id+':'+row.summaryRevision,value=store.decode('state',slot,(await store.db.get('SELECT payload FROM state WHERE slot=$1',slot)).payload);
    delete value.publicationDescriptor;if(missingReferences)delete value.referenceTargets;
    row.summaryRevision=digest(serialize(value));const older='record-summary:'+row.id+':'+row.summaryRevision;
    await store.db.run('INSERT INTO state VALUES ($1,$2)',older,store.encode('state',older,value));
   }
   await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',etag,manifest),etag);
  }));
  const original=ResearchCatalogue.prototype.record,loaded=[];
  ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return original.call(this,id,...args);};
  let context;
  try{context=await appearancePreviewPage(f.workspace,{workspaceId:book.id,etag,appearance:book.appearance,mode:'website'},'entries/'+target.id+'.html');}
  finally{ResearchCatalogue.prototype.record=original;}
  if(!missingReferences)assert.ok(loaded.length<=5,'Only the entry, its two neighbours and its actual public backlink require originals; loaded '+loaded.length);
  assert.ok(context.entryDestinations.length<=4);assert.ok(context.entryDestinations.some(r=>r.id===related.id));
  assert.ok(!context.entryDestinations.some(r=>r.id===privateRecord.id));
  const html=renderPublication(context,{emitBrowse:false}).files.get('entries/'+target.id+'.html');
  assert.ok(html.includes(related.title));assert.ok(!html.includes(privateRecord.title));
  assert.equal((await f.workspace.outline()).etag,etag);
  if(missingReferences){
   const access=await createAccess('','synthetic legacy preview recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
   const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'recovered')),access,vault,f.vault);
   const restored=await appearancePreviewPage(new Workspace(destination,vault),{workspaceId:book.id,etag,appearance:book.appearance,mode:'website'},'entries/'+target.id+'.html');
   assert.deepEqual(restored,context);
  }
  await assert.rejects(appearancePreviewPage(f.workspace,{workspaceId:book.id,etag,appearance:book.appearance,mode:'website'},'entries/'+target.id+'.html',{signal:AbortSignal.abort()}),{name:'AbortError'});
  t.diagnostic(JSON.stringify({records:count,missingReferences,originalReads:loaded.length,retainedDescriptors:context.entryDestinations.length}));
 }
});
