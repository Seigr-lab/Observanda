// Retained upload receipts describe a prefix of an independently owned import.
// A finalized import is read once from its original, not once per old chunk.
import path from 'node:path';
import {evidenceFileStamp} from './project-evidence-file-stamp.js';
import {ResearchMaterials} from './research-materials.js';
import {FileContent} from './file-content.js';
import {artifactRelative} from './project-artifact-content.js';
import {retiredMetadataSourceLocation,retainedMetadataValue} from './project-retired-metadata.js';
import {adoptedMetadataFact,exclusiveMetadataFact} from './project-metadata-ownership.js';
import {withRetiredProjectCatalogue} from './project-retired-records.js';
import {digest,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {fingerprintStep,emptyFingerprintChain} from './web/evidence-fingerprint.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
export const uploadMetadataKey=id=>{if(!researchId(id))damaged();return 'metadata:.observanda/materials/imports/'+id+'/session.json';};
export const uploadChunkRelative=(id,index)=>{if(!researchId(id)||!Number.isSafeInteger(index)||index<0)damaged();return '.observanda/materials/imports/'+id+'/'+index+'.chunk';};
export async function retainedUploadSession(store,owner,key,revision){
 const fact=await adoptedMetadataFact(store,owner,key);if(!exclusiveMetadataFact(fact,owner.projectId)||fact.sourceRevision!==revision)damaged();
 const value=await retainedMetadataValue(store,revision);if(typeof value.text!=='string'||Buffer.byteLength(value.text)>16*1024*1024)damaged();let session;try{session=JSON.parse(value.text);}catch{damaged();}
 if(uploadMetadataKey(session.id)!==key||!researchId(session.recordId))damaged();new ResearchMaterials(store.workspace).uploads.validate(session);return session;
}
export async function* retainedUploadChunks(store,session,{signal,offset=0}={}){
 const materials=new ResearchMaterials(store.workspace),count=materials.uploads.count(session);if(session.completed||!Number.isSafeInteger(offset)||offset<0||offset>count)damaged();
 const current=await materials.importState(session.id);if(current.id!==session.id||current.recordId!==session.recordId||current.size!==session.size||materials.uploads.count(current)<count)damaged();
 let chain=emptyFingerprintChain;const accept=async entry=>{if(offset===0)chain=await fingerprintStep(chain,entry.index,entry.receipt,digest);return entry;};
 let page=null;const expected=async index=>{if(Array.isArray(session.chunks))return materials.uploads.receipt(session,session.chunks[index],index);if(!page||index>=page.offset+page.items.length)page={offset:index,...await materials.sequences.page(session.chunksIndex,{offset:index,limit:64})};return materials.uploads.receipt(session,page.items[index-page.offset],index);};
 if(current.completed){
  const doc=await materials.read(current.completed);if(doc.kind!=='artifact'||doc.recordId!==session.recordId||doc.content.size!==session.size)damaged();const relative=artifactRelative(doc),file=path.join(store.workspace.root,...relative.split('/')),stamp=await evidenceFileStamp(store.workspace.root,relative),content=new FileContent(store.workspace,file,doc.content.size,doc.content.sha256),location={relative,stamp,size:content.size,sha256:content.sha256};
  let index=offset,pending=Buffer.alloc(0);if(index===count)return;
  // FileContent authenticates the complete envelope before yielding its range.
  for await(const bytes of content.read(offset*session.chunkSize,materials.uploads.bytes(session)-1,{signal})){
   pending=pending.length?Buffer.concat([pending,bytes]):bytes;
   while(index<count){const receipt=await expected(index);if(pending.length<receipt.size)break;const chunk=pending.subarray(0,receipt.size);pending=pending.subarray(receipt.size);if(digest(chunk)!==receipt.sha256)damaged();yield await accept({index:index++,bytes:chunk,receipt,location});}
  }
  if(index!==count||pending.length)damaged();
 }else for(let index=offset;index<count;index++){
  signal?.throwIfAborted();const receipt=await expected(index),relative=uploadChunkRelative(session.id,index),file=path.join(store.workspace.root,...relative.split('/')),stamp=await evidenceFileStamp(store.workspace.root,relative),content=new FileContent(store.workspace,file,receipt.size,receipt.sha256),chunks=[];for await(const chunk of content.read(0,receipt.size-1,{signal}))chunks.push(chunk);const bytes=Buffer.concat(chunks);
  signal?.throwIfAborted();if(serialize(stamp)!==serialize(await evidenceFileStamp(store.workspace.root,relative)))throw new AppError('CONFLICT');yield await accept({index,bytes,receipt,location:{relative,stamp,size:receipt.size,sha256:receipt.sha256}});
 }
 if(offset===0&&chain!==await materials.uploads.chain(session))damaged();
}
export async function withRetiredUploadChunks(workspace,session,consume,options={}){
 if(workspace.projectId||await workspace.storageKind()!=='catalogue')return null;
 return workspace.catalogue(async store=>{
  const key=uploadMetadataKey(session.id),location=await retiredMetadataSourceLocation(store,key);if(!location)return null;
  return withRetiredProjectCatalogue(store,location.owner,{kind:'record',id:session.recordId,domain:'research'},async selected=>{
   const archived=await retainedUploadSession(selected,location.owner,key,location.revision);if(serialize(archived)!==serialize(session))damaged();
   return {value:await consume(retainedUploadChunks(selected,archived,options))};
  });
 });
}
