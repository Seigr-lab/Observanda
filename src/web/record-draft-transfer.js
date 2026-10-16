import {browserHash} from './evidence-fingerprint.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE,RECORD_DRAFT_DIRECT_BYTES} from './record-draft-protocol.js';
import {upgradeOwnedRecord} from './record-model.js';
import {jsonChunks,yieldJSONWork} from './json-chunks.js';
import {directRecordCheckpoint,recordCheckpointIdentity} from './record-checkpoint-identity.js';
import {sha256} from './vendor/sha256.js';
import {incrementalJSONDecoder} from './vendor/json-parser.js';
import {t} from './i18n/index.js';
const base64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const invalid=()=>{throw Object.assign(Error(t('recordDrafts','invalidPage')),{code:'FORMAT'});};
const decode=value=>{try{if(typeof value!=='string')invalid();return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{invalid();}};

export async function writeRecordCheckpoint(api,command,options){
 const signal=options?.signal;signal?.throwIfAborted();
 if(await directRecordCheckpoint(command,RECORD_DRAFT_DIRECT_BYTES,{signal}))return api('/api/research/drafts/write',command,options);
 const {bytes,sha256:transferHash}=await recordCheckpointIdentity(command.changes,{signal}),owner={id:command.id,workspaceId:command.workspaceId};
 const started=await api('/api/research/drafts/transfer/start',{...owner,expectedRevision:command.expectedRevision,bytes,sha256:transferHash},options);if(started.revision)return started;
 if(!Number.isSafeInteger(started.receivedChunks)||started.receivedChunks<0||started.receivedChunks>Math.ceil(bytes/SIZE))invalid();
 let index=0,start=performance.now();
 for(const part of jsonChunks(command.changes,{size:SIZE,signal})){
  if(index++<started.receivedChunks){start=await yieldJSONWork(start,signal);continue;}
  const result=await api('/api/research/drafts/transfer/part',{...owner,transferHash,index:index-1,bytes:base64(part),sha256:await browserHash(part)},options);if(result.revision)return result;
 }
 signal?.throwIfAborted();return api('/api/research/drafts/transfer/finish',{...owner,transferHash},options);
}

export async function readRecordCheckpoint(api,id,options,header){
 const result=header??await api('/api/research/drafts/read',{id},options);if(![3,4].includes(result?.draft?.formatVersion))return result;
 const draft=result.draft,content=draft.content,owner={id,workspaceId:draft.workspaceId,expectedRevision:result.revision};
 if(!Number.isSafeInteger(content?.bytes)||content.bytes<1||draft.count!==1)invalid();
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),parser=incrementalJSONDecoder(),hash=sha256.create();let received=0;
 const parse=bytes=>{try{parser.write(bytes===undefined?decoder.decode():decoder.decode(bytes,{stream:true}));}catch{invalid();}};
 try{
 for(let index=0;index*SIZE<content.bytes;index++){
  options?.signal?.throwIfAborted();const part=await api('/api/research/drafts/transfer/readPart',{...owner,index},options);
  options?.signal?.throwIfAborted();const chunk=decode(part?.bytes);
  if(chunk.length!==Math.min(SIZE,content.bytes-index*SIZE)||await browserHash(chunk)!==part.sha256)invalid();
  hash.update(chunk);received+=chunk.length;parse(chunk);
 }
 options?.signal?.throwIfAborted();parse();if(received!==content.bytes)invalid();
 // The current editor still owns a complete selected record; only transport and
 // recovery storage are paged here. Visible-block editing is a separate owner.
 if(Array.from(hash.digest(),v=>v.toString(16).padStart(2,'0')).join('')!==content.sha256)invalid();let changes;
 try{changes=parser.finish();}catch{invalid();}
 if(!Array.isArray(changes)||changes.length!==1||!changes[0]?.record||!draft.base||changes[0].record.id!==draft.base.recordId||changes[0].baseRevision!==draft.base.revision||changes[0].expectedRevision!==draft.base.revision)invalid();
 const {base}=await api('/api/research/drafts/transfer/readBase',owner,options);
 options?.signal?.throwIfAborted();
 return {...result,draft:{formatVersion:1,id,workspaceId:draft.workspaceId,updatedAt:draft.updatedAt,changes:[{base,record:upgradeOwnedRecord(changes[0].record),expectedRevision:changes[0].expectedRevision}]}};
 }catch(error){if(options?.signal?.aborted)throw options.signal.reason;throw error;}
 finally{hash.destroy();parser.discard();}
}
