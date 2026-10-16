import {websiteContext} from './website-context.js';
import {revisionId} from './revision-model.js';
const aborted=()=>new DOMException('Website source discovery changed','AbortError');
const tokenValid=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096;
// A cursor holds owner addresses and opaque continuations, never record payloads.
// Every source is queried independently; no reply becomes an authoring draft.
export function publicationOwnerWindows({state,api,access=run=>run(),snapshots=()=>[],operation,limit,local,validate,key,errorMessage}){
 const invalid=()=>{throw Error(errorMessage());};
 return async({search='',cursor=null,signal}={})=>{
  const sources=structuredClone(state.book.website.researchSources??[]);
  if(!sources.length)return local({search,cursor,signal});
  const identity=JSON.stringify([operation,websiteContext(state),state.book.id,state.etag,sources,search]),host=state.book.id;
  const valid=()=>state.page==='website'&&!state.access?.locked&&!state.storageUnavailable&&identity===JSON.stringify([operation,websiteContext(state),state.book.id,state.etag,state.book.website.researchSources??[],search]);
  const check=()=>{signal?.throwIfAborted();if(!valid())throw aborted();};check();
  const owners=[...(state.book.notebooks.length?[null]:[]),...sources],pin=Object.fromEntries(snapshots().map(source=>[source.workspaceId,source.snapshotId]));
  let at=cursor?.index??0,token=cursor?.token??null,backward=cursor?.backward??false,page=cursor?.page??0,pins={...pin,...cursor?.pins},tails={...cursor?.tails},direction=cursor?.direction??1;
  if(cursor&&(cursor.identity!==identity||!Number.isSafeInteger(at)||at<0||at>=owners.length||!Number.isSafeInteger(page)||page<0||typeof backward!=='boolean'||![1,-1].includes(direction)||!tokenValid(token)||Object.entries(pins).some(([id,revision])=>!sources.some(source=>source.workspaceId===id)||!revisionId(revision))))invalid();
  const wrap=(index,token,backward,page,direction)=>({identity,index,token,backward,page,direction,pins:{...pins},tails:{...tails}});
  for(;;){
   check();const source=owners[at];let result;
   if(!source)result=await local({search,cursor:token,signal});
   else{
    const owner=state.projectOwner,route='/api/projects/'+(owner?.projectId?owner.projectId+'/'+(owner.labBookId?'lab-books/'+owner.labBookId+'/':''):'')+'publication-source';
    const command={workspaceId:host,sourceId:source.workspaceId,operation,query:{workspaceId:source.workspaceId,snapshotId:pins[source.workspaceId]??null,source,search,cursor:token,backward}};
    const response=await access(()=>{check();return api(route,command,{adopt:false,signal});});check();result=response?.value;
    if(response?.owner?.workspaceId!==source.workspaceId||result?.workspaceId!==source.workspaceId||!revisionId(result.snapshotId)||pins[source.workspaceId]&&pins[source.workspaceId]!==result.snapshotId||!Array.isArray(result.items)||result.items.length>limit||![result.previousCursor,result.nextCursor].every(tokenValid)||result.items.some(item=>!item||!validate(item,source))||new Set(result.items.map(key)).size!==result.items.length)invalid();
    pins[source.workspaceId]=result.snapshotId;result={...result,items:result.items.map(item=>({...item,snapshotId:result.snapshotId}))};
   }
   check();if(result.nextCursor===null)tails[at]={token,backward};
   if(!result.items.length){
    const continuation=direction<0?result.previousCursor:result.nextCursor;
    if(continuation!==null){token=continuation;backward=direction<0;continue;}
    const index=at+direction;
    if(index>=0&&index<owners.length){at=index;token=direction<0?tails[at]?.token??null:null;backward=direction<0?tails[at]?.backward??false:false;continue;}
   }
   const previousCursor=page===0?null:result.previousCursor!==null?wrap(at,result.previousCursor,true,page-1,-1):at>0?wrap(at-1,tails[at-1]?.token??null,tails[at-1]?.backward??false,page-1,-1):null;
   const nextCursor=result.nextCursor!==null?wrap(at,result.nextCursor,false,page+1,1):at+1<owners.length?wrap(at+1,null,false,page+1,1):null;
   return {items:result.items,total:null,offset:page*limit,previousCursor,nextCursor};
  }
 };
}
