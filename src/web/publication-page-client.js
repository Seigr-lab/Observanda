import {websiteContext} from './website-context.js';
import {websiteRecordPages,WEBSITE_PAGE_LIMIT} from './website-page-query.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
const invalid=()=>{throw Error(t('websitePages','invalid'));};
const aborted=()=>new DOMException('Website page discovery changed','AbortError');
const tokenValid=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096;
// A cursor holds owner addresses and opaque continuations, never record payloads.
// Every source is queried independently; no reply becomes an authoring draft.
export function publicationPageClient({state,api,access=run=>run(),snapshots=()=>[]}){
 return async({search='',cursor=null,signal}={})=>{
  const sources=structuredClone(state.book.website.researchSources??[]);
  if(!sources.length)return websiteRecordPages({state,api,search,cursor,signal});
  const identity=JSON.stringify([websiteContext(state),state.book.id,state.etag,sources,search]),host=state.book.id;
  const valid=()=>state.page==='website'&&!state.access?.locked&&!state.storageUnavailable&&identity===JSON.stringify([websiteContext(state),state.book.id,state.etag,state.book.website.researchSources??[],search]);
  const check=()=>{signal?.throwIfAborted();if(!valid())throw aborted();};check();
  const owners=[...(state.book.notebooks.length?[null]:[]),...sources],pin=Object.fromEntries(snapshots().map(source=>[source.workspaceId,source.snapshotId]));
  let at=cursor?.index??0,token=cursor?.token??null,backward=cursor?.backward??false,page=cursor?.page??0,pins={...pin,...cursor?.pins},tails={...cursor?.tails},direction=cursor?.direction??1;
  if(cursor&&(cursor.identity!==identity||!Number.isSafeInteger(at)||at<0||at>=owners.length||!Number.isSafeInteger(page)||page<0||typeof backward!=='boolean'||![1,-1].includes(direction)||!tokenValid(token)||Object.entries(pins).some(([id,revision])=>!sources.some(source=>source.workspaceId===id)||!revisionId(revision))))invalid();
  const wrap=(index,token,backward,page,direction)=>({identity,index,token,backward,page,direction,pins:{...pins},tails:{...tails}});
  for(;;){
   check();const source=owners[at];let result;
   if(!source)result=await websiteRecordPages({state,api,search,cursor:token,signal});
   else{
    const owner=state.projectOwner,route='/api/projects/'+(owner?.projectId?owner.projectId+'/'+(owner.labBookId?'lab-books/'+owner.labBookId+'/':''):'')+'publication-source';
    const command={workspaceId:host,sourceId:source.workspaceId,operation:'pages',query:{workspaceId:source.workspaceId,snapshotId:pins[source.workspaceId]??null,source,search,cursor:token,backward}};
    const response=await access(()=>{check();return api(route,command,{adopt:false,signal});});check();result=response?.value;
    if(response?.owner?.workspaceId!==source.workspaceId||result?.workspaceId!==source.workspaceId||!revisionId(result.snapshotId)||pins[source.workspaceId]&&pins[source.workspaceId]!==result.snapshotId||!Array.isArray(result.items)||result.items.length>WEBSITE_PAGE_LIMIT||![result.previousCursor,result.nextCursor].every(tokenValid)||new Set(result.items.map(item=>item.target)).size!==result.items.length||result.items.some(item=>!researchId(item.record?.id)||!researchId(item.record.notebookId)||item.owner?.workspaceId!==source.workspaceId||item.target!=='entry:'+item.record.id||item.path!=='entries/'+item.record.id+'.html'||typeof item.title!=='string'||item.title.length>180||typeof item.context!=='string'))invalid();
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
   return {items:result.items,total:null,offset:page*WEBSITE_PAGE_LIMIT,previousCursor,nextCursor};
  }
 };
}

export async function publicationPageSections({state,api,access=run=>run(),item,offset=0,signal}){
 const source=state.book.website.researchSources?.find(source=>source.workspaceId===item.owner?.workspaceId);
 if(!source||!revisionId(item.snapshotId)||item.target!=='entry:'+item.record?.id)invalid();
 const identity=JSON.stringify([websiteContext(state),state.book.id,state.etag,source]);
 const check=()=>{signal?.throwIfAborted();if(state.page!=='website'||state.access?.locked||state.storageUnavailable||identity!==JSON.stringify([websiteContext(state),state.book.id,state.etag,state.book.website.researchSources?.find(value=>value.workspaceId===source.workspaceId)]))throw aborted();};check();
 const owner=state.projectOwner,route='/api/projects/'+(owner?.projectId?owner.projectId+'/'+(owner.labBookId?'lab-books/'+owner.labBookId+'/':''):'')+'publication-source';
 const response=await access(()=>{check();return api(route,{workspaceId:state.book.id,sourceId:source.workspaceId,operation:'page-sections',query:{workspaceId:source.workspaceId,snapshotId:item.snapshotId,source,target:item.target,offset}},{adopt:false,signal});});check();
 const result=response?.value;
 if(response?.owner?.workspaceId!==source.workspaceId||result?.workspaceId!==source.workspaceId||result.snapshotId!==item.snapshotId||result.target!==item.target||result.offset!==offset||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.items)||result.items.length!==Math.min(25,Math.max(0,result.total-offset))||result.previous!==(offset?offset-25:null)||result.next!==(offset+25<result.total?offset+25:null)||result.items.some(section=>typeof section.title!=='string'||!section.id?.startsWith('record-section-')||!researchId(section.id.slice(15))))invalid();
 return result;
}
