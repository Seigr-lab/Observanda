import path from 'node:path';
import {AppError} from '../errors.js';
import {assertRegular} from '../storage.js';
import {describeContent} from '../file-content.js';
import {validateDetachedRecords} from '../model.js';
import {importId,hashValue,sourceFingerprint,mappedId,validateMapping,importHash} from './import-model.js';
import {sourceAttributes} from './content.js';
import {MetadataFeed} from '../metadata-feed.js';
import {recordRevision} from '../research.js';
import {importedArtifactId} from './import-evidence.js';

const prefix='metadata:.observanda/migration/';
const fail=()=>{throw new AppError('IMPORT_DAMAGED');};
// Run in the caller's catalogue snapshot, including detached backup/rekey
// verification. Never reopen the source folder or execute a source adapter.
export async function verifyImports(catalogue){
 const read=async name=>{const object=await catalogue.object(prefix+name+'.json');if(!object||typeof object.text!=='string')fail();try{return JSON.parse(object.text);}catch{fail();}};
 for await(const name of catalogue.objectIdEntries(prefix+'originals/')){
  const sha256=name.slice((prefix+'originals/').length,-5);if(!name.endsWith('.json')||!hashValue(sha256))fail();
  const original=await read('originals/'+sha256);
  if(original.sha256!==sha256||!importId(original.storageId)||!Number.isSafeInteger(original.bytes)||original.bytes<0)fail();
  const file=path.join(catalogue.workspace.root,'.observanda','materials','originals',original.storageId,original.storageId+'.original');
  try{await assertRegular(path.dirname(file),{directory:true});await assertRegular(file);const content=await describeContent(catalogue.workspace,file);if(content.size!==original.bytes||content.sha256!==sha256)fail();}
  catch(error){if(error instanceof AppError&&error.code==='IMPORT_DAMAGED')throw error;fail();}
 }
 const workspaceId=(await catalogue.snapshot()).metadata.id;
 for await(const name of catalogue.objectIdEntries(prefix+'batches/')){
  const id=name.slice((prefix+'batches/').length,-5);if(!name.endsWith('.json')||!importId(id))fail();
  const batch=await read('batches/'+id);
  if(batch.id!==id||batch.workspaceId!==workspaceId||batch.version!==1||!Number.isInteger(batch.count)||batch.count<1||batch.count>10000||!Array.isArray(batch.files)||batch.files.length>20000||!Number.isInteger(batch.staged)||batch.staged<0||batch.staged>batch.files.length)fail();
  const item=await read('batch-list/'+id),feed=new MetadataFeed(catalogue.workspace,'.observanda/migration/batch-list');
  if(item.id!==id||item.createdAt!==batch.createdAt||JSON.stringify(await read('batch-list-order/'+feed.key(item).slice(0,-5)))!==JSON.stringify(item))fail();
  for(const file of batch.files.slice(0,batch.staged)){const original=await read('originals/'+file.sha256);if(original.bytes!==file.bytes)fail();}
  const manifest=batch.files.slice(0,batch.staged).find(file=>file.path===batch.manifest);let attributes=null;
  if(manifest){const original=await read('originals/'+manifest.sha256),file=path.join(catalogue.workspace.root,'.observanda','materials','originals',original.storageId,original.storageId+'.original');attributes=await sourceAttributes((await describeContent(catalogue.workspace,file)).stream());}
  for(let index=0;index<batch.count;index++){
   const row=await read('objects/'+id+'/'+String(index).padStart(5,'0'));if(row.index!==index||!row.source||!row.mapping)fail();
   // Unreviewed mappings may still need correction; committed ones may not.
   if(['ready','committed','reversed'].includes(batch.state))validateMapping(row.mapping,row.source);
   if(attributes&&(row.attributesText??null)!==(attributes.get(index)??null))fail();
   if(row.prepared?.sourceRecord){
    const record=row.prepared.sourceRecord;if(record.id!==mappedId(workspaceId,batch.source.namespace,row.source.id)||record.share)fail();validateDetachedRecords([record]);
    if(row.prepared.attributesText!==(row.attributesText??null)||row.prepared.sourceFingerprint!==sourceFingerprint(row.source,row.prepared.attributesText))fail();
   }
   if(['committed','reversed'].includes(batch.state)&&!row.prepared)fail();
  }
  if(['committed','reversed'].includes(batch.state)){
   if(!batch.receipt||!Array.isArray(batch.receipt.owned)||!Array.isArray(batch.receipt.materialChanges)||batch.receipt.owned.length>batch.count||batch.receipt.materialChanges.length>batch.count)fail();
   const owned=new Set();for(const change of batch.receipt.owned){
    if(!Number.isInteger(change.index)||change.index<0||change.index>=batch.count||owned.has(change.id))fail();owned.add(change.id);
    const p=(await read('objects/'+id+'/'+String(change.index).padStart(5,'0'))).prepared;
    if(!p.record||change.id!==p.record.id||change.before!==p.storedRevision||change.after!==recordRevision(p.record))fail();
   }
  }
 }
 for await(const name of catalogue.objectIdEntries(prefix+'batch-list-order/')){
  const key=name.slice((prefix+'batch-list-order/').length,-5),item=await read('batch-list-order/'+key),batch=await read('batches/'+item.id);
  if(item.id!==batch.id||item.createdAt!==batch.createdAt||new MetadataFeed(catalogue.workspace,'.observanda/migration/batch-list').key(item)!==key+'.json')fail();
 }
 for await(const name of catalogue.objectIdEntries(prefix+'evidence-repairs/')){
  const relative=name.slice((prefix+'evidence-repairs/').length),parts=relative.split('/');
  if(parts.length!==2||!importId(parts[0])||!parts[1].endsWith('.json')||!hashValue(parts[1].slice(0,-5)))fail();
  const batch=await read('batches/'+parts[0]),receipt=await read('evidence-repairs/'+relative.slice(0,-5));
  if(!['committed','reversed'].includes(batch.state)||receipt.review!==parts[1].slice(0,-5)||!Array.isArray(receipt.associations)||receipt.associations.length>50||receipt.repaired!==receipt.associations.length||!Number.isFinite(Date.parse(receipt.at)))fail();
  const seen=new Set();
  for(const association of receipt.associations){
   if(!Number.isInteger(association.index)||association.index<0||association.index>=batch.count||!Number.isInteger(association.file)||association.file<0)fail();
   const row=await read('objects/'+batch.id+'/'+String(association.index).padStart(5,'0')),file=row.source.files[association.file],record=row.prepared?.sourceRecord,ref=association.artifact;
   if(!record||!file||ref?.kind!=='artifact'||!hashValue(ref.revision)||ref.id!==importedArtifactId(workspaceId,record.id,file)||seen.has(ref.id))fail();seen.add(ref.id);
   const object=await catalogue.object('metadata:.observanda/materials/objects/'+ref.id+'/'+ref.revision+'.json');let doc;try{doc=JSON.parse(object.text);}catch{fail();}
   if(importHash(doc)!==ref.revision||doc.recordId!==record.id||doc.content.name!==path.posix.basename(file.path)||doc.content.sourcePath!==file.path||doc.content.sha256!==file.sha256||doc.content.size!==file.bytes||doc.content.acquisition?.kind!=='record'||doc.content.acquisition.id!==record.id||doc.content.acquisition.revision!==recordRevision(record))fail();
  }
 }
 for(const group of ['identities','revisions','datasets'])for await(const name of catalogue.objectIdEntries(prefix+group+'/')){
  const key=name.slice((prefix+group+'/').length,-5),value=await read(group+'/'+key);
  if(!importId(value.batchId)||!Number.isInteger(value.index)||value.index<0||value.index>=10000)fail();
  const batch=await read('batches/'+value.batchId);if(!['committed','reversed'].includes(batch.state)||value.index>=batch.count)fail();
  const row=await read('objects/'+value.batchId+'/'+String(value.index).padStart(5,'0')),p=row.prepared;if(!p?.sourceRecord)fail();
  if(group==='datasets'){
   const change=batch.receipt.materialChanges.find(c=>c.id===key);if(!change||p.dataset?.id!==key||importHash(value.head)!==importHash(change.after))fail();
  }else{
   if(key!==p[group==='identities'?'identityKey':'versionKey']||value.fingerprint!==p.fingerprint||recordRevision(value.sourceRecord)!==recordRevision(p.sourceRecord))fail();
   if(group==='identities'&&(value.id!==p.sourceRecord.id||value.createdAt!==p.sourceRecord.createdAt)||group==='revisions'&&value.sourceFingerprint!==p.sourceFingerprint)fail();
  }
 }
}
