// Read one retained module transport under the caller's fixed source read.
// Ownership is unavailable until all authenticated chunks identify the item.
import {ModuleDraftTransfer} from './modules/draft-transfer.js';
import {DRAFT_CHUNK_BYTES} from './web/modules/draft-protocol.js';
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function readProjectModuleDraftTransfer(workspace,id,namespaceId,{signal,manifest}={}){
 manifest??=await new ModuleDraftTransfer(workspace).manifest(id);
 if(manifest.id!==id||manifest.workspaceId!==namespaceId)damaged();
 if(manifest.etag)return {manifest,value:null};
 const bytes=Buffer.alloc(manifest.size),count=Math.ceil(manifest.size/DRAFT_CHUNK_BYTES);
 try{
  for(let index=0;index<count;index++){
   signal?.throwIfAborted();const raw=await workspace.readMetadata('.observanda/module-draft-transfers/'+id+'/'+index+'.json',2*DRAFT_CHUNK_BYTES);if(raw===null)throw new AppError('PROJECT_MIGRATION_DRAFT_INCOMPLETE');
   let part;try{part=JSON.parse(raw);}catch{damaged();}
   if(!part||Object.keys(part).sort().join()!=='bytes,sha256'||typeof part.bytes!=='string'||typeof part.sha256!=='string')damaged();
   const chunk=Buffer.from(part.bytes,'base64');try{if(chunk.toString('base64')!==part.bytes||digest(chunk)!==part.sha256||chunk.length!==Math.min(DRAFT_CHUNK_BYTES,manifest.size-index*DRAFT_CHUNK_BYTES))damaged();chunk.copy(bytes,index*DRAFT_CHUNK_BYTES);}finally{chunk.fill(0);}
  }
  if(digest(bytes)!==manifest.sha256)damaged();let value;try{value=JSON.parse(bytes);}catch{damaged();}
  if(value.workspaceId!==namespaceId||value.id!==id||value.etag!==manifest.baseEtag)damaged();return {manifest,value};
 }finally{bytes.fill(0);}
}
