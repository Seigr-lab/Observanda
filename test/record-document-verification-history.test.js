import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {digest,serialize} from '../src/storage-format.js';
import {withQueryValue,retainQueryValue} from '../src/record-query-storage.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {verifyRecordDocument} from '../src/record-document-verification.js';
import {publicationDescriptor} from '../src/publication-record-descriptor.js';

test('verify original pre-consent and current publication query fields in both stored query formats',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-historical-projection-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(dir,book);
 t.after(async()=>{await clearVault(f.vault);await rm(dir,{recursive:true,force:true,maxRetries:10});});
 const prior=(await f.workspace.read()).book.entries[0],next=structuredClone(prior);next.attachments=[];next.figures=[];next.sections=Array.from({length:30},(_,i)=>({id:randomUUID(),title:'Test '+i,body:'Historical observation '.repeat(118)}));
 const record=(await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:next.id,expectedRevision:recordRevision(prior),record:next}]},{recordIds:[next.id]})).book.entries[0];
 const fixtures=await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=(await Array.fromAsync(store.members(snapshot))).find(r=>r.id===record.id),revision=recordRevision(record);
  assert.ok(row.bytes>65535);const source={slot:'record-query:'+row.id+':'+row.queryRevision,revision:row.queryRevision},saved=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
  const query=await withQueryValue(store,store.decode('state',source.slot,saved.payload),source,row,({tree,value})=>tree?tree.read(value.root):value);
  assert.equal(query.publicationDescriptor.sourcePermissionVersion,1);assert.equal(query.editionInventory.sourcePermissionVersion,1);
  query.publicationDescriptor=publicationDescriptor(record,undefined,{legacy:true});
  const {id,title,sections,template,attachments,figures}=record;
  const fields=template?.fields??[];
  query.editionInventory={
   id,title,
   choice:{id,revision,include:true,body:true,sections:sections.map(s=>s.id),fields:fields.map(f=>f.key),
    attachments:attachments.filter(a=>a.share).map(a=>a.id),figures:figures.map(f=>({id:f.id,data:false}))},
   sections:sections.map(({id,title})=>({id,title})),
   fields:fields.map(({key,label})=>({id:key,title:label})),
   attachments:attachments.map(({id,kind,caption,alt})=>({id,kind,title:caption||alt||''})),
   figures:figures.map(({id,title})=>({id,title}))
  };
  async function retain(blocks){
   const value=blocks?await retainQueryValue(store,query):query;
   if(blocks)assert.equal(value.format,'observanda-record-query-blocks');
   const rev=digest(serialize(value)),slot='record-query:'+row.id+':'+rev;
   await store.db.run('INSERT INTO state(slot,payload) VALUES($1,$2) ON CONFLICT(slot) DO NOTHING',slot,store.encode('state',slot,value));
   return {...row,queryRevision:rev};
  }
  const old=[await retain(false),await retain(true)];
  query.editionInventory.title='unexpected';
  const damaged=await retain(false);
  query.editionInventory.title=title;
  query.editionInventory.sourcePermissionVersion=77;
  const future=await retain(true);
  return {snapshot,row,old,damaged,future};
 }));
 await f.workspace.catalogue(async store=>{
  const {snapshot,row,old,damaged,future}=fixtures,summaries=await new SnapshotIndex(store).validationRows(snapshot.membership,[{id:row.id,type:row.type,sections:[],relations:row.runOf.map(target=>({role:'run-of',target}))}]);
  const verify=r=>verifyRecordDocument(store,r,snapshot.metadata,summaries,null);
  await verify(row);
  for(const historical of old)await verify(historical);
  for(const invalid of [damaged,future])await assert.rejects(verify(invalid),{code:'CATALOGUE_DAMAGED'});
 });
});
