import {RecordStarters,STARTER_ROOT} from './record-starters.js';
import {StarterValueBlocks} from './record-starter-documents.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {projectSourceDeclaredOwner} from './project-source-declared-owner.js';
import {RECORD_DRAFT_CHUNK_BYTES} from './web/record-draft-protocol.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {serialize} from './storage-format.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const uploadRoot='.observanda/record-starter-uploads';
export const newStarterPart=id=>/^metadata:\.observanda\/record-starter-values\/(value|index)\/[a-f0-9]{64}\.json$/.test(id);
export function projectSourceStarterOwner(store,inventory,record,{signal}={}){
 const workspace=store.workspace,source=new RecordStarters(workspace),declared=projectSourceDeclaredOwner(store,inventory.namespaceId,{signal}),facts=new Map();
 const together=(...owners)=>({kind:'projects',projectIds:[...new Set(owners.filter(owner=>owner?.kind==='project').map(owner=>owner.projectId))]});
 async function object(file){const value=await source.object(file);if(!value)damaged();return value;}
 async function capture(id){
  const key='capture:'+id;if(facts.has(key))return facts.get(key);const value=await object(STARTER_ROOT+'/captures/'+id+'.json');
  if(value.target?.workspaceId!==inventory.namespaceId||!researchId(value.target.recordId)||!revisionId(value.target.snapshotId)||!revisionId(value.request)||!revisionId(value.root)||!Number.isSafeInteger(value.received)||value.received<0||!Number.isSafeInteger(value.last)||value.last< -1)damaged();
  const owner=await record(value.target.recordId),template=value.finished?await declared('starter',id):null,result=together(owner,template);if(facts.size>=128)facts.delete(facts.keys().next().value);facts.set(key,result);return result;
 }
 async function upload(id){
  const content=await object(uploadRoot+'/'+id+'.json');if(!new RecordDraftChunks(workspace,id,{starter:true}).valid(content,{complete:false}))damaged();
  const use=await source.object(STARTER_ROOT+'/package-uses/'+id+'.json');let accepted=null;
  if(use){if(!researchId(use.id)||!revisionId(use.fingerprint))damaged();accepted=await declared('starter',use.id);}
  const owner=await declared('starterUpload',id,{required:!accepted});if(owner&&accepted&&serialize(owner)!==serialize(accepted))throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return owner??accepted;
 }
 return async id=>{
  if(!id.startsWith('metadata:.observanda/record-starter'))return null;
  return workspace.inspectCatalogue(store,async()=>{
   signal?.throwIfAborted();let match;const tail=id.slice(('metadata:'+STARTER_ROOT+'/').length);
   if(id.startsWith('metadata:'+STARTER_ROOT+'/')){
    if((match=/^(?:headers|drafts)\/([a-f0-9-]{36})\.json$/.exec(tail))||(match=/^(?:releases|history|commands)\/([a-f0-9-]{36})\/[^/]+\.json$/.exec(tail)))return declared('starter',match[1]);
    if(id==='metadata:'+source.feed.marker){if(!await source.feed.initialized())damaged();return {kind:'derived'};}
    if((match=/^headers-order\/\d{13}-([a-f0-9-]{36})\.json$/.exec(tail))){const header=await source.header(match[1]),pointer=await object(id.slice(9));if(pointer.id!==header.id||pointer.createdAt!==header.createdAt||id!=='metadata:'+source.feed.order+'/'+source.feed.key(header))damaged();return declared('starter',match[1]);}
    if((match=/^uses\/([a-f0-9-]{36})\.json$/.exec(tail))){const value=await object(id.slice(9));if(!researchId(value.templateId)||!revisionId(value.release)||!revisionId(value.commandHash))damaged();return together(await record(match[1]),await declared('starter',value.templateId));}
    if((match=/^captures\/([a-f0-9-]{36})(?:\.json|\/(?:0|[1-9][0-9]*)\.json)$/.exec(tail)))return capture(match[1]);
    if((match=/^packages\/([a-f0-9-]{36})\.json$/.exec(tail)))return upload(match[1]);
    if((match=/^package-uses\/([a-f0-9-]{36})\.json$/.exec(tail))){const value=await object(id.slice(9));if(!researchId(value.id)||!revisionId(value.fingerprint))damaged();return declared('starter',value.id);}
   }
   if((match=/^metadata:\.observanda\/record-starter-uploads\/([a-f0-9-]{36})\.json$/.exec(id)))return upload(match[1]);
   if((match=/^metadata:\.observanda\/record-starter-uploads\/by-file\/([a-f0-9]{64})\.json$/.exec(id))){const alias=await object(id.slice(9));if(!researchId(alias.id)||(await object(uploadRoot+'/'+alias.id+'.json')).sha256!==match[1])damaged();return upload(alias.id);}
   if((match=/^metadata:\.observanda\/record-starter-upload-blocks\/([a-f0-9-]{36})\/(nodes|chunks)\/([a-f0-9]{64})\.json$/.exec(id))){await new RecordDraftChunks(workspace,match[1],{starter:true}).read(match[2],match[3],match[2]==='nodes'?8192:2*RECORD_DRAFT_CHUNK_BYTES);return upload(match[1]);}
   if((match=/^metadata:\.observanda\/record-starter-staging\/([a-f0-9-]{36})\/(value|index)\/([a-f0-9]{64})\.json$/.exec(id))){await new StarterValueBlocks(workspace,{staging:match[1]}).read(match[2],match[3]);return upload(match[1]);}
   return null;
  });
 };
}
