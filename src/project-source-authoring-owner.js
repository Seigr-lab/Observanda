// Classify changed authoring checkpoints through their domain readers. Cache
// only small ownership facts; transported bodies are never retained here.
import {ResearchDrafts} from './research-drafts.js';
import {ResearchDraftTransfer} from './research-draft-transfer.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {projectDraftOwnership,projectDraftTransferOwnership} from './project-authoring-draft-ownership.js';
import {RECORD_DRAFT_CHUNK_BYTES} from './web/record-draft-protocol.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function projectSourceAuthoringOwner(store,inventory,record,{signal}={}){
 const workspace=store.workspace,drafts=new ResearchDrafts(workspace),transfers=new ResearchDraftTransfer(workspace),facts=new Map();
 const source={...inventory,record:async id=>{const fact=await record(id,{required:false});return fact?{...fact,selected:fact.projectId===inventory.projectId}:null;}};
 async function owner(id,kind){
  const key=kind+':'+id;if(facts.has(key))return facts.get(key);
  const current=await drafts.read(id,{expand:false,header:true});let fact;
  if(kind==='draft'){if(!current)damaged();fact=await projectDraftOwnership(workspace,source,current.draft,{signal});}
  else {const manifest=await transfers.manifest(id);if(manifest)fact=await projectDraftTransferOwnership(workspace,source,manifest,current,{signal});else if(kind==='blocks'&&current)fact=await projectDraftOwnership(workspace,source,current.draft,{signal});else damaged();}
  const value={kind:'projects',projectIds:fact.projectIds};if(facts.size>=128)facts.delete(facts.keys().next().value);facts.set(key,value);return value;
 }
 return async id=>{
  if(!/^metadata:\.observanda\/(?:drafts|draft-list|record-draft-transfers|record-draft-blocks)(?:[/.])/.test(id))return null;
  return workspace.inspectCatalogue(store,async()=>{
   signal?.throwIfAborted();let match;
   if(id==='metadata:.observanda/draft-list.json'){if(!await drafts.index.initialized(inventory.namespaceId))damaged();return {kind:'derived'};}
   if((match=/^metadata:\.observanda\/drafts\/([a-f0-9-]{36})\.json$/.exec(id)))return owner(match[1],'draft');
   if((match=/^metadata:\.observanda\/draft-list\/\d{13}-([a-f0-9-]{36})\.json$/.exec(id))){const current=await drafts.read(match[1],{expand:false,header:true});if(!current||id!=='metadata:'+drafts.index.path(current.draft))damaged();return owner(match[1],'draft');}
   if((match=/^metadata:\.observanda\/record-draft-transfers\/([a-f0-9-]{36})\.json$/.exec(id)))return owner(match[1],'transfer');
   if((match=/^metadata:\.observanda\/record-draft-blocks\/([a-f0-9-]{36})\/(nodes|chunks)\/([a-f0-9]{64})\.json$/.exec(id))){await new RecordDraftChunks(workspace,match[1]).read(match[2],match[3],match[2]==='nodes'?8192:2*RECORD_DRAFT_CHUNK_BYTES);return owner(match[1],'blocks');}
   return null;
  });
 };
}
