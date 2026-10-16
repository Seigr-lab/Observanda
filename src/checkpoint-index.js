// Recovery lists share the authenticated metadata index. Summary edits and
// original checkpoints commit together under the workspace writer lock.
import {ObjectIndex} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
const objectIndex=store=>store.objectIndex?.()??new ObjectIndex(store);
const hash=value=>digest(serialize(value)),fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const validCheckpointTime=value=>typeof value==='string'&&Number.isSafeInteger(Date.parse(value))&&Date.parse(value)>=0&&Date.parse(value)<=9999999999999;
export const checkpointKey=draft=>String(9999999999999-Date.parse(draft.updatedAt)).padStart(13,'0')+'-'+draft.id+'.json';
export function validCheckpointSummary(value){
 return value&&researchId(value.id)&&researchId(value.workspaceId)&&revisionId(value.revision)&&revisionId(value.sourceRevision)&&validCheckpointTime(value.updatedAt)&&Number.isSafeInteger(value.count)&&value.count>0&&Array.isArray(value.titles)&&value.titles.length===Math.min(value.count,3)&&value.titles.every(t=>typeof t==='string'&&t.length<=160);
}
export class CheckpointIndex{
 constructor(workspace,read,{source,order,cursorKind,summary,validSummary,scopeOf=()=>''}){
  this.workspace=workspace;this.read=read;this.source='metadata:'+source+'/';this.prefix='metadata:'+order+'/';this.order=order;this.marker=order+'.json';
  this.cursorKind=cursorKind;this.summary=summary;this.validSummary=validSummary;this.scopeOf=scopeOf;
 }
 path(summary){return this.order+'/'+(this.scopeOf(summary)?this.scopeOf(summary)+'/':'')+checkpointKey(summary);}
 async initialized(workspaceId){
  const raw=await this.workspace.readMetadata(this.marker,1024);if(raw===null)return false;
  let value;try{value=JSON.parse(raw);}catch{fail();}
  if(value?.version!==1||value.workspaceId!==workspaceId)fail();return true;
 }
 async ensureLocked(workspaceId,{signal}={}){
  if(await this.initialized(workspaceId))return;
  await this.workspace.catalogue(async store=>{
   const initial=objectIndex(store);for await(const entry of initial.entries(await initial.head(),this.prefix)){void entry;fail();}
   let after=null;
   for(;;){
    const index=objectIndex(store),head=await index.head(),batch=[];
    for await(const entry of index.entries(head,this.source,after)){signal?.throwIfAborted();batch.push(entry);if(batch.length===64)break;}
    if(!batch.length)break;
    for(const entry of batch){
     signal?.throwIfAborted();const id=entry.id.slice(this.source.length,-5);
     if(!entry.id.endsWith('.json')||!researchId(id))fail();
     const result=await this.read(id);if(!result||result.draft.workspaceId!==workspaceId)fail();
     await this.putLocked(result,entry.revision);
    }
    after=batch.at(-1).id;
   }
  });
  signal?.throwIfAborted();await this.workspace.writeMetadata(this.marker,serialize({version:1,workspaceId}));
 }
 async ensure(workspaceId,options){if(!await this.initialized(workspaceId))await this.workspace.withLock(()=>this.ensureLocked(workspaceId,options));}
 async putLocked(result,sourceRevision){
  const summary=this.summary(result,sourceRevision);if(summary===null)return;if(!this.validSummary(summary))fail();
  await this.workspace.writeMetadata(this.path(summary),serialize(summary));
 }
 async removeLocked(draft){await this.workspace.removeMetadata(this.path(draft));}
 async verifySelected(result,sourceRevision){
  if(!await this.initialized(result.draft.workspaceId))return;
  const expected=this.summary(result,sourceRevision);
  const raw=await this.workspace.readMetadata(this.path(result.draft),4096);
  if(expected===null){if(raw!==null)fail();return;}
  let summary;try{summary=JSON.parse(raw);}catch{fail();}
  if(!this.validSummary(summary)||hash(summary)!==hash(expected))fail();
 }
 async page(workspaceId,{cursor=null,excludeId=null,limit=10,scope=''},{signal}={}){
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const prefix=this.prefix+(scope?scope+'/':'');let anchor={after:null,reverse:false};
   if(cursor){try{anchor=store.decode(this.cursorKind,workspaceId,Buffer.from(cursor,'base64url'));}catch(error){if(error.code==='ACCESS_LOCKED')throw error;throw new AppError('DRAFT_CURSOR');}
    if(!anchor||anchor.workspaceId!==workspaceId||(anchor.scope??'')!==scope||anchor.excludeId!==excludeId||anchor.limit!==limit||typeof anchor.reverse!=='boolean'||typeof anchor.after!=='string'||!/^\d{13}-[a-f0-9-]{36}\.json$/.test(anchor.after)||!researchId(anchor.after.slice(14,-5)))throw new AppError('DRAFT_CURSOR');
   }
   const index=objectIndex(store),head=await index.head();
   if(!await this.initialized(workspaceId)){
    // Reading recovery must not request the workspace writer. Older stores
    // are scanned in the current snapshot with only one page in memory; the
    // next checkpoint write creates the durable index in its transaction.
    for await(const entry of index.entries(head,this.prefix)){void entry;fail();}
    const items=[];let more=false,first=null,last=null;
    for await(const entry of index.entries(head,this.source)){
     signal?.throwIfAborted();const id=entry.id.slice(this.source.length,-5);
     if(!entry.id.endsWith('.json')||!researchId(id))fail();
     const result=await this.read(id);if(!result||result.draft.workspaceId!==workspaceId)fail();
     const summary=this.summary(result,entry.revision);if(summary===null)continue;if(!this.validSummary(summary))fail();
     if(this.scopeOf(summary)!==scope||summary.id===excludeId)continue;
     const key=checkpointKey(summary);if(first===null||key<first)first=key;if(last===null||key>last)last=key;
     if(anchor.after&&(anchor.reverse?key>=anchor.after:key<=anchor.after))continue;
     const {sourceRevision,workspaceId:owner,...visible}=summary;void sourceRevision;void owner;items.push(visible);
     items.sort((a,b)=>(checkpointKey(a)<checkpointKey(b)?-1:1)*(anchor.reverse?-1:1));if(items.length>limit){items.pop();more=true;}
    }
    if(anchor.reverse)items.reverse();
    const opposite=items.length&&(anchor.reverse?last>checkpointKey(items.at(-1)):first<checkpointKey(items[0]));
    const encode=(item,reverse)=>store.encode(this.cursorKind,workspaceId,{workspaceId,scope,excludeId,limit,after:checkpointKey(item),reverse}).toString('base64url');
    signal?.throwIfAborted();return {workspaceId,drafts:items,previousCursor:items.length&&(anchor.reverse?more:opposite)?encode(items[0],true):null,nextCursor:items.length&&(anchor.reverse?opposite:more)?encode(items.at(-1),false):null};
   }
   const rows=(reverse,after)=>reverse?index.reverseEntries(head,prefix,after===null?null:prefix+after):index.entries(head,prefix,after===null?null:prefix+after);
   const items=[];let more=false;
   for await(const entry of rows(anchor.reverse,anchor.after)){
    signal?.throwIfAborted();
    if(entry.id.slice(-41,-5)===excludeId)continue;
    if(items.length===limit){more=true;break;}
    const value=await store.objectValue(entry.id,entry);let summary;
    try{summary=JSON.parse(value.text);}catch{fail();}
    if(!this.validSummary(summary)||summary.workspaceId!==workspaceId||this.scopeOf(summary)!==scope||entry.id!==prefix+checkpointKey(summary))fail();
    const original=await index.find(head,this.source+summary.id+'.json');
    if(original?.revision!==summary.sourceRevision)fail();
    const {sourceRevision,workspaceId:owner,...visible}=summary;void sourceRevision;void owner;items.push(visible);
   }
   if(anchor.reverse)items.reverse();
   let opposite=false;
   // Live lists keep no cursor stack or transaction between requests.
   if(items.length)for await(const entry of rows(!anchor.reverse,checkpointKey(anchor.reverse?items.at(-1):items[0]))){
    signal?.throwIfAborted();if(entry.id.slice(-41,-5)!==excludeId){opposite=true;break;}
   }
   const encode=(after,reverse)=>store.encode(this.cursorKind,workspaceId,{workspaceId,scope,excludeId,limit,after,reverse}).toString('base64url');
   signal?.throwIfAborted();return {workspaceId,drafts:items,
    previousCursor:items.length&&(anchor.reverse?more:opposite)?encode(checkpointKey(items[0]),true):null,
    nextCursor:items.length&&(anchor.reverse?opposite:more)?encode(checkpointKey(items.at(-1)),false):null};
  });
 }
}
