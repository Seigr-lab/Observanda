// Writes a record checkpoint through the server's draft endpoints the way an
// API client does: a small compact draft goes through drafts/write, a larger
// one through the bounded transfer (start, numbered parts, finish).
import {createHash} from 'node:crypto';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE,RECORD_DRAFT_DIRECT_BYTES} from '../src/web/record-draft-protocol.js';
import {upgradeOwnedRecord} from '../src/web/record-model.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function direct(command){
 const compact=command.changes?.length===1&&Object.hasOwn(command.changes[0],'baseRevision');
 // The direct endpoint admits its pretty-printed stored envelope.
 return !compact||Buffer.byteLength(JSON.stringify({formatVersion:2,...command,updatedAt:'2000-01-01T00:00:00.000Z'},null,2))<=RECORD_DRAFT_DIRECT_BYTES;
}
export async function writeDraftTransfer(api,command,options){
 if(direct(command))return api('/api/research/drafts/write',command,options);
 const content=Buffer.from(JSON.stringify(command.changes)),sha256=digest(content),owner={id:command.id,workspaceId:command.workspaceId};
 const started=await api('/api/research/drafts/transfer/start',{...owner,expectedRevision:command.expectedRevision,bytes:content.length,sha256},options);if(started.revision)return started;
 for(let index=started.receivedChunks;index*SIZE<content.length;index++){
  const part=content.subarray(index*SIZE,(index+1)*SIZE);
  const result=await api('/api/research/drafts/transfer/part',{...owner,transferHash:sha256,index,bytes:part.toString('base64'),sha256:digest(part)},options);if(result.revision)return result;
 }
 return api('/api/research/drafts/transfer/finish',{...owner,transferHash:sha256},options);
}
// Reads a paged checkpoint back through readPart and readBase, verifying every
// part and the whole content against the authenticated header.
export async function readDraftTransfer(api,id,options){
 const result=await api('/api/research/drafts/read',{id},options);if(![3,4].includes(result?.draft?.formatVersion))return result;
 const draft=result.draft,content=draft.content,owner={id,workspaceId:draft.workspaceId,expectedRevision:result.revision},parts=[];
 for(let index=0;index*SIZE<content.bytes;index++){
  const part=await api('/api/research/drafts/transfer/readPart',{...owner,index},options),bytes=Buffer.from(part.bytes,'base64');
  if(bytes.length!==Math.min(SIZE,content.bytes-index*SIZE)||digest(bytes)!==part.sha256)throw Object.assign(Error('Invalid draft part'),{code:'FORMAT'});
  parts.push(bytes);
 }
 const whole=Buffer.concat(parts);if(whole.length!==content.bytes||digest(whole)!==content.sha256)throw Object.assign(Error('Invalid draft content'),{code:'FORMAT'});
 const changes=JSON.parse(whole.toString('utf8')),{base}=await api('/api/research/drafts/transfer/readBase',owner,options);
 return {...result,draft:{formatVersion:1,id,workspaceId:draft.workspaceId,updatedAt:draft.updatedAt,changes:[{base,record:upgradeOwnedRecord(changes[0].record),expectedRevision:changes[0].expectedRevision}]}};
}
