import {recordRunMembers} from './record-run-members.js';
import {recordReferenceCandidates} from './record-reference-candidates.js';
import {recordReferenceNamespaces} from './research-reference-namespace.js';
import {QUERY_ORDER_VERSION} from './web/query-order.js';
// Private record browsing reuses saved-view scopes and the shared filter rules.
import {summaryPage} from './summary-page.js';
import {AppError} from './errors.js';
import {digest} from './storage.js';
import {upgradeNotebook} from './model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validViewQuery,viewScopeIssue} from './web/record-view-model.js';
import {recordQueryMatcher,recordQueryOrder,recordQueryDocument} from './web/record-query.js';
import {notebooksIn} from './web/workspace-structure.js';
import {recordCounts} from './web/record-workflow.js';
import {validRecordDate} from './web/record-date.js';
import {recordRevision,historicalBook} from './research.js';
import {activityContext} from './web/record-activity.js';
const invalidCursor=()=>{throw new AppError('RECORD_QUERY_CURSOR');};
export class RecordQuery{
 constructor(workspace){this.workspace=workspace;}
 async list({workspaceId,query,relatedTo=null,selection=null,runOf=null,snapshotId=null,cursor=null,limit=25}={},{signal}={}){
  signal?.throwIfAborted();
  if(!researchId(workspaceId)||!validViewQuery(query)||!Number.isSafeInteger(limit)||limit<1||limit>100||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
  if(snapshotId!==null&&!revisionId(snapshotId))throw new AppError('INVALID');
  if(relatedTo!==null&&(!relatedTo||Object.keys(relatedTo).sort().join()!=='id,workspaceId'||!researchId(relatedTo.workspaceId)||!researchId(relatedTo.id)))throw new AppError('INVALID');
  if(runOf!==null&&(!researchId(runOf)||relatedTo!==null))throw new AppError('INVALID');
  if(selection!==null&&(!selection||Object.keys(selection).sort().join()!==['excludeId','recordType',...(Object.hasOwn(selection,'includeRevisions')?['includeRevisions']:[])].sort().join()||Object.hasOwn(selection,'includeRevisions')&&typeof selection.includeRevisions!=='boolean'||selection.excludeId!==null&&!researchId(selection.excludeId)||!['all','run','non-run','subject'].includes(selection.recordType)))throw new AppError('INVALID');
  const queryHash=digest(JSON.stringify({order:QUERY_ORDER_VERSION,scope:runOf?{query,relatedTo,selection,runOf}:selection?{query,relatedTo,selection}:relatedTo?{query,relatedTo}:query}));
  const run=async({head,manifest,documents,encode,decode,resolveRevision,matchedSearch=false,referenceNamespaces=null})=>{
   let anchor;
   if(cursor){try{anchor=decode(cursor);}catch{invalidCursor();}}
   else anchor={workspaceId,snapshotId:snapshotId??head,queryHash,offset:0,limit};
   if(!anchor||anchor.workspaceId!==workspaceId||!revisionId(anchor.snapshotId)||snapshotId!==null&&anchor.snapshotId!==snapshotId||anchor.queryHash!==queryHash||anchor.limit!==limit||!Number.isSafeInteger(anchor.offset)||anchor.offset<0)invalidCursor();
   if(anchor.offset>0&&(!anchor.after||!researchId(anchor.after.id)||typeof anchor.after.title!=='string'||!validRecordDate(anchor.after.occurredOn)))invalidCursor();
   const source=await manifest(anchor.snapshotId),book=source.metadata;
   if(book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(viewScopeIssue(book,query))throw new AppError('RECORD_VIEW_SCOPE');
   const notebookIds=new Set(query.notebookId?[query.notebookId]:notebooksIn(book,query.projectId,{recursive:true}).map(n=>n.id));
   const domains=new Set();
   const matches=recordQueryMatcher({...query,...(matchedSearch?{search:''}:{}),relatedTo,referenceNamespaces,notebook:query.notebookId??'all'}),order=recordQueryOrder(query.browse),page=summaryPage({...anchor,order}),counts=recordCounts([]);
   for await(const value of documents(source,notebookIds)){
    signal?.throwIfAborted();
    if(!notebookIds.has(value.notebookId))continue;
    // Pickers need one bounded page, not a growing catalogue of all templates.
    if(selection&&(value.id===selection.excludeId||selection.recordType==='run'&&value.type!=='run'||selection.recordType==='non-run'&&value.type==='run'))continue;
    if(selection?.recordType==='subject'&&!activityContext(book,value).subject)continue;
    if(!selection&&value.template?.profileId)domains.add(value.template.profileId);
    if(!matches(value))continue;
    const increment=recordCounts([value]);for(const key of Object.keys(counts))counts[key]+=increment[key];
    const {searchText,referenceTargets,cardSources,...summary}=value;void cardSources;if(relatedTo)summary.linkedBy=referenceTargets.filter(t=>(referenceNamespaces??[relatedTo.workspaceId]).includes(t.workspaceId)&&t.id===relatedTo.id).map(({type,revision})=>({type,...(revision?{revision}:{})}));
    page.add(summary);
   }
   const {records:found,total,after,previousAfter}=page.finish();
   if(selection)for(const item of found){
    signal?.throwIfAborted();
    // Older summaries may lack a canonical revision. Read only this selected
    // page in that case; never load every candidate body while searching.
    if(item.revision===null&&selection.includeRevisions!==false)item.revision=await resolveRevision(source,item);
    delete item.storageRevision;
   }
   const next=anchor.offset+found.length;
   const previous=anchor.offset?{workspaceId,snapshotId:anchor.snapshotId,queryHash,limit,offset:Math.max(0,anchor.offset-limit),...(anchor.offset>limit?{after:previousAfter}:{})}:null;
   return {workspaceId,snapshotId:anchor.snapshotId,records:found,recordTypes:[],domains:[...domains].sort(),total,counts,offset:anchor.offset,
    cursor:encode(anchor),previousCursor:previous?encode(previous):null,nextCursor:next<total?encode({...anchor,offset:next,after}):null,changed:head!==anchor.snapshotId};
  };
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const head=await store.head();if((await store.snapshot(head)).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const referenceNamespaces=relatedTo?await recordReferenceNamespaces(store,relatedTo):null;
   const rows=(source,ids)=>runOf?recordRunMembers(store,source,runOf,{signal,notebookIds:ids}):relatedTo?recordReferenceCandidates({store,snapshot:source,notebooks:ids,workspaceId:relatedTo.workspaceId,signal,search:query.search,fallback:()=>store.members(source,{signal,notebookIds:ids})},relatedTo.id):store.searchMembers(source,ids,query.search,{signal});
   return run({head,matchedSearch:true,referenceNamespaces,manifest:id=>store.snapshot(id),documents:(source,ids)=>store.queryDocuments(rows(source,ids),source.metadata,{signal,search:false,matching:query.search,references:!!relatedTo,revisions:!!selection&&selection.includeRevisions!==false}),
    resolveRevision:async(source,item)=>recordRevision(historicalBook(source.metadata,await store.record(item.id,item.storageRevision)).entries[0]),
    encode:value=>store.encode('record-query-page',workspaceId,value).toString('base64url'),decode:value=>store.decode('record-query-page',workspaceId,Buffer.from(value,'base64url'))});
  });
  // Older file-backed fixtures retain their original storage; opening a view
  // never converts a workspace. A changed file requires a fresh result list.
  const current=await this.workspace.read(),book=upgradeNotebook(current.book);
  if(book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return run({head:current.etag,manifest:async id=>{if(id!==current.etag)invalidCursor();return {metadata:book};},
   documents:async function*(){for(const record of book.entries)if(!runOf||record.type==='run'&&record.relations.some(link=>link.role==='run-of'&&link.target.workspaceId===workspaceId&&link.target.id===runOf))yield {...recordQueryDocument(record),...(selection?{revision:recordRevision(record)}:{})};},
   encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'))});
 }
 async open({workspaceId,recordId,baseEtag}={}){
  if(!researchId(workspaceId)||!researchId(recordId)||!revisionId(baseEtag))throw new AppError('INVALID');
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const source=await store.snapshot();if(source.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(!await store.member(source,recordId))throw new AppError('RECORD_CHANGED');
   return [20,21].includes(source.metadata.formatVersion)?store.recordPatch(baseEtag):store.read();
  });
  const result=await this.workspace.read();if(result.book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(!result.book.entries.some(r=>r.id===recordId))throw new AppError('RECORD_CHANGED');return result;
 }
}
