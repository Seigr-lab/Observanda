import {t} from './i18n/index.js';
import {recordBrowse} from './record-query.js';
import {researchId} from './research-reference.js';
import {websitePageWindow,WEBSITE_PAGE_LIMIT} from './website-page-targets.js';

export {WEBSITE_PAGE_LIMIT};
export async function websiteRecordPages({state,api,search='',cursor=null,signal}){
 signal?.throwIfAborted();
 const {book,etag,storage}=state,workspaceId=book.id,contextId=storage?.contextId,limit=WEBSITE_PAGE_LIMIT;
 if(storage?.researchStorage!=='catalogue'||storage.researchFormatVersion!==21)return websitePageWindow(book,{kind:'entry',search,offset:cursor??0,limit});
 const page=await api('/api/research/records/query',{workspaceId,snapshotId:etag,query:{projectId:null,notebookId:null,filter:'all',search,browse:recordBrowse({sort:'title'})},selection:{excludeId:null,recordType:'all',includeRevisions:false},cursor,limit},{adopt:false,signal});
 signal?.throwIfAborted();
 if(state.page!=='website'||state.book?.id!==workspaceId||state.storage?.contextId!==contextId||state.etag!==etag||state.access?.locked||state.storageUnavailable)throw new DOMException('Page discovery context changed','AbortError');
 if(page?.workspaceId!==workspaceId||page.snapshotId!==etag||!Array.isArray(page.records)||page.records.length>limit||!Number.isSafeInteger(page.offset)||page.offset<0||page.offset%limit||!Number.isSafeInteger(page.total)||page.total<0||page.records.length!==Math.min(limit,page.total-page.offset)||![page.cursor,page.previousCursor,page.nextCursor].every((c,i)=>i===0?typeof c==='string'&&c.length>0&&c.length<=4096:c===null||typeof c==='string'&&c.length>0&&c.length<=4096)||Boolean(page.previousCursor)!==Boolean(page.offset)||Boolean(page.nextCursor)!==(page.offset+page.records.length<page.total)||page.records.some(r=>!r||!researchId(r.id)||!researchId(r.notebookId)||typeof r.title!=='string')||new Set(page.records.map(r=>r.id)).size!==page.records.length)throw Error(t('websitePages','invalid'));
 return {items:page.records.map(r=>({target:'entry:'+r.id,path:'entries/'+r.id+'.html',title:r.title,context:book.notebooks.find(n=>n.id===r.notebookId)?.title??t('websitePages','entry')})),offset:page.offset,total:page.total,previousCursor:page.previousCursor,nextCursor:page.nextCursor,changed:page.changed};
}
