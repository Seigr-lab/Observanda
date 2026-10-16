// Draft contents stay in encrypted workspace checkpoints, never browser storage.
import {t} from '../i18n/index.js';
import {researchId} from '../research-reference.js';
import {revisionId} from '../revision-model.js';
import {writeModuleCheckpoint} from './draft-transfer.js';
const tr=(key,args)=>t('moduleRecovery',key,args);
const checkpointDrafts=drafts=>drafts.length===1&&Object.hasOwn(drafts[0],'expectedRevision')?drafts.map(({base,...draft})=>({...draft,baseRevision:draft.expectedRevision})):drafts;
export async function moduleRecovery({api,workspaceId,moduleId,onStatus,onChange=()=>{}}){
 const requestApi=api;api=(route,data,options={})=>requestApi(route,data,{...options,view:'#/modules/'+encodeURIComponent(moduleId)});
 // Each editor lifetime gets a new writer identity. Empty checkpoints are not
 // listed, so reusing a prior session ID with a null etag creates false conflicts.
 let id=crypto.randomUUID(),etag=null,timer=null,writing=null,stopped=false,error=null;
 let page=null,listing=false,listError=null,controller=null,request=0,cursor=null,retryCursor=null;
 let latest=[],persisted='[]',pending=null,writes=Promise.resolve();
 // Autosaves and removal of a recovered checkpoint share one write lane.
 const write=operation=>{
  const result=writes.then(async()=>{
   for(let attempt=0;;attempt++)try{return await operation();}catch(e){
    if(e.code!=='LOCKED'||attempt===3||stopped)throw e;
    await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
   }
  });
  writes=result.catch(()=>{});return result;
 };
 async function flush(){
  clearTimeout(timer);
  while(writing){await writing;if(stopped)return;}
  const captured=pending?.captured??JSON.stringify(checkpointDrafts(latest));
  if(stopped||captured===persisted&&!error)return;
  // A lost reply must replay the exact uncertain write before newer input uses
  // its returned etag. The same writer never sends a different payload against
  // an unknown checkpoint revision.
  pending??={captured,id,etag};const request=pending;
  writing=write(()=>writeModuleCheckpoint(api,{workspaceId,moduleId,id:request.id,etag:request.etag,drafts:JSON.parse(captured)},request)).then(result=>{etag=result.etag;persisted=captured;pending=null;error=null;},e=>{error=e;}).finally(()=>{writing=null;onStatus?.(error);});
  await writing;
  if(!error&&captured!==JSON.stringify(checkpointDrafts(latest))&&!stopped)return flush();
  else if(error?.code==='LOCKED'&&!stopped)timer=setTimeout(flush,1200);
 }
 async function load(next=null){
  controller?.abort();const attempt=++request;controller=new AbortController();listing=true;listError=null;retryCursor=next;onChange();
  try{
   const result=await api('/api/modules/drafts/list',{workspaceId,moduleId,excludeId:id,cursor:next,limit:10},{signal:controller.signal});
   if(stopped||attempt!==request)return;
   if(result?.workspaceId!==workspaceId||!Array.isArray(result.drafts)||result.drafts.length>10||new Set(result.drafts.map(d=>d?.id)).size!==result.drafts.length||
    !['previousCursor','nextCursor'].every(key=>result[key]===null||typeof result[key]==='string'&&result[key].length>0&&result[key].length<=4096)||
    !result.drafts.every(d=>researchId(d.id)&&d.id!==id&&d.moduleId===moduleId&&revisionId(d.revision)&&Number.isFinite(Date.parse(d.updatedAt))&&Number.isSafeInteger(d.count)&&d.count>0&&Array.isArray(d.titles)&&d.titles.length===Math.min(d.count,3)&&d.titles.every(title=>typeof title==='string'&&title.length<=160)))throw Error(tr('invalid'));
   page=result;cursor=next;
  }catch(e){if(!stopped&&attempt===request&&e.name!=='AbortError')listError=e;}
  finally{if(!stopped&&attempt===request){listing=false;onChange();}}
 }
 const canPark=()=>!stopped&&!writing&&!pending&&!error&&JSON.stringify(checkpointDrafts(latest))===persisted;
 function parkSaved(){
  if(!canPark())return false;
  clearTimeout(timer);id=crypto.randomUUID();etag=null;latest=[];persisted='[]';pending=null;return true;
 }
 await load();
 return {
  get available(){return page?.drafts??[];},get error(){return error;},get page(){return page;},get loading(){return listing;},get listError(){return listError;},
  load,refresh:()=>load(),retry:()=>load(retryCursor),
  schedule(drafts){latest=structuredClone(checkpointDrafts(drafts));clearTimeout(timer);timer=setTimeout(flush,600);},
  flush,
  canPark,parkSaved,
  async captureReturn(){
   await flush();if(error)throw error;if(!canPark())throw new Error(tr('unavailable'));
   return latest.length&&etag?{workspaceId,moduleId,id,etag}:null;
  },
  async readReturn(token){
   if(stopped||token?.workspaceId!==workspaceId||token.moduleId!==moduleId||!researchId(token.id)||!revisionId(token.etag))throw new Error(tr('unavailable'));
   const result=await api('/api/modules/drafts/read',{id:token.id});
   if(stopped)throw new DOMException('Recovery owner changed','AbortError');
   if(result?.etag!==token.etag||result.draft?.id!==token.id||result.draft.workspaceId!==workspaceId||result.draft.moduleId!==moduleId||!Array.isArray(result.draft.drafts))throw new Error(tr('unavailable'));
   return result.draft.drafts;
  },
  async retireReturn(token){
   if(token?.workspaceId!==workspaceId||token.moduleId!==moduleId||!researchId(token.id)||!revisionId(token.etag)||token.id===id)throw new Error(tr('unavailable'));
   await write(()=>api('/api/modules/drafts/write',{workspaceId,moduleId,id:token.id,etag:token.etag,drafts:[]}));
   if(!stopped)await load();
  },
  completionFor(draft){
   // Capture the durable editor checkpoint before dispatching a save. A late
   // receipt may retire only that exact saved draft, never newer recovery work.
   const captured=JSON.parse(persisted),saved=captured.find(value=>value.id===draft.id);
   if(writing||pending||error||!etag||!saved||JSON.stringify(saved.data)!==JSON.stringify(draft.data))return async()=>false;
   const request={workspaceId,moduleId,id,etag,drafts:captured.filter(value=>value.id!==draft.id)},transfer={};
   return async()=>{
    if(!stopped)return false;
    try{await write(()=>writeModuleCheckpoint(api,request,transfer));return true;}
    catch{return false;} // Retain recovery if its owner changed or cleanup failed.
   };
  },
  async park(){
   await flush();if(error)throw error;if(stopped)throw new Error(tr('unavailable'));
   // A durable checkpoint becomes a paged recovery item. Only the new active
   // writer stays in memory; a failed write never releases the caller's draft.
   if(!parkSaved())throw new Error(tr('unavailable'));
  },
  async restore(draftId){const result=await api('/api/modules/drafts/read',{id:draftId});if(result?.draft?.id!==draftId||result.draft.workspaceId!==workspaceId||result.draft.moduleId!==moduleId||!Array.isArray(result.draft.drafts))throw new Error(tr('unavailable'));return result.draft.drafts;},
  async remove(draftId){const draft=page?.drafts.find(d=>d.id===draftId);if(!draft)throw Error(tr('unavailable'));await write(()=>api('/api/modules/drafts/write',{workspaceId,moduleId,id:draft.id,etag:draft.revision,drafts:[]}));await load(cursor);if(!page?.drafts.length&&cursor)await load();},
  stop(){clearTimeout(timer);stopped=true;request++;controller?.abort();page=null;latest=[];persisted='[]';pending=null;}
 };
}
