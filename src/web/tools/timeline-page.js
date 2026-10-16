import {validateTimelineCollectionPage} from './timeline-collection-page.js';
import {researchId} from '../research-reference.js';
import {revisionId} from '../revision-model.js';
import {validRecordDate} from '../record-date.js';
import {timelineOrder} from './timeline-model.js';

// Validate one reply before retaining it. Original bodies and unrelated metadata
// are not part of the timeline's client contract.
export function validateTimelinePage(page,{workspaceId,limit,query,snapshotId=null,collection=false}){
 if(collection)return validateTimelineCollectionPage(page,{workspaceId,limit,query,snapshotId});
 if(page?.collection)throw Error('TIMELINE_RESPONSE');
 const bad=()=>{throw Error('TIMELINE_RESPONSE');};
 if(page?.workspaceId!==workspaceId||!revisionId(page.snapshotId)||snapshotId!==null&&page.snapshotId!==snapshotId||!Array.isArray(page.records)||page.records.length>limit||!Number.isSafeInteger(page.total)||page.total<0||!Number.isSafeInteger(page.offset)||page.offset<0||page.offset%limit||page.records.length!==Math.min(limit,page.total-page.offset)||typeof page.changed!=='boolean'||!Number.isSafeInteger(page.missingSources)||page.missingSources<0||page.missingSources>query.projects.length+query.books.length||!Array.isArray(page.books)||page.books.length>page.records.length||!Array.isArray(page.projects)||page.projects.length>page.books.length||typeof page.cursor!=='string'||!page.cursor||![page.previousCursor,page.nextCursor].every(c=>c===null||typeof c==='string'&&!!c)||Boolean(page.previousCursor)!==Boolean(page.offset)||Boolean(page.nextCursor)!==(page.offset+page.records.length<page.total))bad();
 const shape=(value,keys)=>value&&typeof value==='object'&&Object.keys(value).sort().join()===keys;
 const unique=items=>new Set(items.map(r=>r?.id)).size===items.length;
 if(!unique(page.records)||!unique(page.books)||!unique(page.projects)||page.projects.some(p=>!shape(p,'id,title')||!researchId(p?.id)||typeof p.title!=='string')||page.books.some(b=>!shape(b,'id,projectId,title')||!researchId(b?.id)||typeof b.title!=='string'||!page.projects.some(p=>p.id===b.projectId))||page.records.some((r,i)=>!shape(r,'id,notebookId,occurredOn,status,title')||!researchId(r?.id)||!page.books.some(b=>b.id===r.notebookId)||typeof r.title!=='string'||typeof r.status!=='string'||!validRecordDate(r.occurredOn)||i>0&&timelineOrder(query)(page.records[i-1],r)>=0))bad();
 return page;
}
