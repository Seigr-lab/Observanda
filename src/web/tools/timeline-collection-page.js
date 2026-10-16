import {researchId} from '../research-reference.js';
import {revisionId} from '../revision-model.js';
import {validRecordOwner} from '../record-collection-client.js';
import {validRecordDate} from '../record-date.js';
import {compareKey} from '../query-order.js';
import {timelineOrder} from './timeline-model.js';
export function validateTimelineCollectionPage(page,{workspaceId,limit,query,snapshotId=null}){
 const bad=()=>{throw Error('TIMELINE_RESPONSE');};
 if(page?.collection!==true||page.workspaceId!==workspaceId||!revisionId(page.snapshotId)||snapshotId!==null&&page.snapshotId!==snapshotId||!Array.isArray(page.records)||page.records.length>limit||!Number.isSafeInteger(page.total)||page.total<0||!Number.isSafeInteger(page.offset)||page.offset<0||page.offset>page.total||page.offset%limit||page.records.length!==Math.min(limit,page.total-page.offset)||typeof page.changed!=='boolean'||!Number.isSafeInteger(page.missingSources)||page.missingSources<0||page.missingSources>query.projects.length+query.books.length||typeof page.cursor!=='string'||!page.cursor||![page.previousCursor,page.nextCursor].every(c=>c===null||typeof c==='string'&&!!c)||Boolean(page.previousCursor)!==Boolean(page.offset)||Boolean(page.nextCursor)!==(page.offset+page.records.length<page.total))bad();
 const seen=new Set(),order=(a,b)=>timelineOrder(query)(a,b)||compareKey(a.owner.workspaceId,b.owner.workspaceId);
 for(const [i,row] of page.records.entries()){
  if(!row||Object.keys(row).sort().join()!=='id,notebookId,occurredOn,owner,status,title'||!researchId(row.id)||!researchId(row.notebookId)||!validRecordOwner(row.owner)||typeof row.title!=='string'||typeof row.status!=='string'||!validRecordDate(row.occurredOn)||i>0&&order(page.records[i-1],row)>=0)bad();
  const key=row.owner.workspaceId+'/'+row.id;if(seen.has(key))bad();seen.add(key);
 }
 return page;
}
