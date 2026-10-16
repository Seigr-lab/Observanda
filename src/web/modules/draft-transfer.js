import {browserHash} from '../evidence-fingerprint.js';
import {DRAFT_CHUNK_BYTES,DRAFT_DIRECT_BYTES} from './draft-protocol.js';
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
// A transfer identity belongs to the exact uncertain write, not later edits.
// Every part and final acknowledgement can be replayed after a lost response.
export async function writeModuleCheckpoint(api,command,pending){
 // Use the stored representation when choosing the transport. A compact JSON
 // array can fit a request while its indented checkpoint exceeds that limit.
 const encoded=new TextEncoder().encode(JSON.stringify(command,null,2)+'\n');
 if(encoded.length<=DRAFT_DIRECT_BYTES)return api('/api/modules/drafts/write',command);
 pending.transferId??=command.id;const id=pending.transferId,workspaceId=command.workspaceId;
 const transferHash=await browserHash(encoded);
 const start=await api('/api/modules/drafts/transfer/start',{workspaceId,id,baseEtag:command.etag,size:encoded.length,sha256:transferHash});if(start.etag)return start;
 for(let index=0;index*DRAFT_CHUNK_BYTES<encoded.length;index++){
  const bytes=encoded.subarray(index*DRAFT_CHUNK_BYTES,(index+1)*DRAFT_CHUNK_BYTES);
  const response=await api('/api/modules/drafts/transfer/part',{workspaceId,id,transferHash,index,bytes:base64(bytes),sha256:await browserHash(bytes)});if(response.etag)return response;
 }
 return api('/api/modules/drafts/transfer/finish',{workspaceId,id,transferHash});
}
