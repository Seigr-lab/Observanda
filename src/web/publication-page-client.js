import {publicationOwnerWindows} from './publication-owner-windows.js';
import {websiteSnapshot} from './website-context.js';
import {websiteRecordPages,WEBSITE_PAGE_LIMIT} from './website-page-query.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
const invalid=()=>{throw Error(t('websitePages','invalid'));};
const aborted=()=>new DOMException('Website page discovery changed','AbortError');
export function publicationPageClient({state,api,...options}){
 return publicationOwnerWindows({state,api,...options,operation:'pages',limit:WEBSITE_PAGE_LIMIT,local:query=>websiteRecordPages({state,api,...query}),errorMessage:()=>t('websitePages','invalid'),key:item=>item.target,
  validate:(item,source)=>researchId(item.record?.id)&&researchId(item.record.notebookId)&&item.owner?.workspaceId===source.workspaceId&&item.target==='entry:'+item.record.id&&item.path==='entries/'+item.record.id+'.html'&&typeof item.title==='string'&&item.title.length<=180&&typeof item.context==='string'});
}

export async function publicationPageSections({state,api,access=run=>run(),item,offset=0,signal}){
 const source=state.book.website.researchSources?.find(source=>source.workspaceId===item.owner?.workspaceId);
 if(!source||!revisionId(item.snapshotId)||item.target!=='entry:'+item.record?.id)invalid();
 const identity=JSON.stringify([websiteSnapshot(state),state.book.id,state.etag,source]);
 const check=()=>{signal?.throwIfAborted();if(state.page!=='website'||state.access?.locked||state.storageUnavailable||identity!==JSON.stringify([websiteSnapshot(state),state.book.id,state.etag,state.book.website.researchSources?.find(value=>value.workspaceId===source.workspaceId)]))throw aborted();};check();
 const owner=state.projectOwner,route='/api/projects/'+(owner?.projectId?owner.projectId+'/'+(owner.labBookId?'lab-books/'+owner.labBookId+'/':''):'')+'publication-source';
 const response=await access(()=>{check();return api(route,{workspaceId:state.book.id,sourceId:source.workspaceId,operation:'page-sections',query:{workspaceId:source.workspaceId,snapshotId:item.snapshotId,source,target:item.target,offset}},{adopt:false,signal});});check();
 const result=response?.value;
 if(response?.owner?.workspaceId!==source.workspaceId||result?.workspaceId!==source.workspaceId||result.snapshotId!==item.snapshotId||result.target!==item.target||result.offset!==offset||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.items)||result.items.length!==Math.min(25,Math.max(0,result.total-offset))||result.previous!==(offset?offset-25:null)||result.next!==(offset+25<result.total?offset+25:null)||result.items.some(section=>typeof section.title!=='string'||!section.id?.startsWith('record-section-')||!researchId(section.id.slice(15))))invalid();
 return result;
}
