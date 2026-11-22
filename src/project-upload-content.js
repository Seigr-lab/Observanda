// Upload chunks are read once from a finalized original, or chunk by chunk
// while the import is still open.
import path from 'node:path';
import {evidenceFileStamp} from './project-evidence-file-stamp.js';
import {ResearchMaterials} from './research-materials.js';
import {FileContent} from './file-content.js';
import {artifactRelative} from './project-artifact-content.js';
import {digest,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {fingerprintStep,emptyFingerprintChain} from './web/evidence-fingerprint.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
// Stored bytes that do not match their receipt are damaged evidence, not an unsupported media file.
async function* contentRange(content,...args){try{yield* content.read(...args);}catch(error){if(error.code==='MEDIA_INVALID')damaged();throw error;}}
export const uploadChunkRelative=(id,index)=>{if(!researchId(id)||!Number.isSafeInteger(index)||index<0)damaged();return '.observanda/materials/imports/'+id+'/'+index+'.chunk';};
export async function* retainedUploadChunks(store,session,{signal,offset=0}={}){
 const materials=new ResearchMaterials(store.workspace),count=materials.uploads.count(session);if(session.completed||!Number.isSafeInteger(offset)||offset<0||offset>count)damaged();
 const current=await materials.importState(session.id);if(current.id!==session.id||current.recordId!==session.recordId||current.size!==session.size||materials.uploads.count(current)<count)damaged();
 let chain=emptyFingerprintChain;const accept=async entry=>{if(offset===0)chain=await fingerprintStep(chain,entry.index,entry.receipt,digest);return entry;};
 let page=null;const expected=async index=>{if(Array.isArray(session.chunks))return materials.uploads.receipt(session,session.chunks[index],index);if(!page||index>=page.offset+page.items.length)page={offset:index,...await materials.sequences.page(session.chunksIndex,{offset:index,limit:64})};return materials.uploads.receipt(session,page.items[index-page.offset],index);};
 if(current.completed){
  const doc=await materials.read(current.completed);if(doc.kind!=='artifact'||doc.recordId!==session.recordId||doc.content.size!==session.size)damaged();const relative=artifactRelative(doc),file=path.join(store.workspace.root,...relative.split('/')),stamp=await evidenceFileStamp(store.workspace.root,relative),content=new FileContent(store.workspace,file,doc.content.size,doc.content.sha256),location={relative,stamp,size:content.size,sha256:content.sha256};
  let index=offset,pending=Buffer.alloc(0);if(index===count)return;
  // FileContent authenticates the complete envelope before yielding its range.
  for await(const bytes of contentRange(content,offset*session.chunkSize,materials.uploads.bytes(session)-1,{signal})){
   pending=pending.length?Buffer.concat([pending,bytes]):bytes;
   while(index<count){const receipt=await expected(index);if(pending.length<receipt.size)break;const chunk=pending.subarray(0,receipt.size);pending=pending.subarray(receipt.size);if(digest(chunk)!==receipt.sha256)damaged();yield await accept({index:index++,bytes:chunk,receipt,location});}
  }
  if(index!==count||pending.length)damaged();
 }else for(let index=offset;index<count;index++){
  signal?.throwIfAborted();const receipt=await expected(index),relative=uploadChunkRelative(session.id,index),file=path.join(store.workspace.root,...relative.split('/')),stamp=await evidenceFileStamp(store.workspace.root,relative),content=new FileContent(store.workspace,file,receipt.size,receipt.sha256),chunks=[];for await(const chunk of contentRange(content,0,receipt.size-1,{signal}))chunks.push(chunk);const bytes=Buffer.concat(chunks);
  signal?.throwIfAborted();if(serialize(stamp)!==serialize(await evidenceFileStamp(store.workspace.root,relative)))throw new AppError('CONFLICT');yield await accept({index,bytes,receipt,location:{relative,stamp,size:receipt.size,sha256:receipt.sha256}});
 }
 if(offset===0&&chain!==await materials.uploads.chain(session))damaged();
}
