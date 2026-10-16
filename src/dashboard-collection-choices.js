import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {summaryPage} from './summary-page.js';
import {compareTitles,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {dashboardCollectionContract} from './dashboard-collection-contract.js';
import {projectCollectionScope} from './project-collection-scope.js';
// Selectors retain bounded pages and selected labels. Project choices use the
// encrypted directory; book choices authenticate metadata without reading records.
export async function dashboardCollectionChoices(pages,client,command,{scope=null,registry,visit,check,signal}){
 if(!command||Object.keys(command).sort().join()!=='config,cursor,etag,kind,limit,options,search,workspaceId')throw new AppError('INVALID');
 const {workspaceId,etag,config,options,kind,search,limit,cursor}=command;
 if(!['projects','notebooks'].includes(kind)||typeof search!=='string'||search.length>160||limit>25)throw new AppError('INVALID');
 const {selection}=dashboardCollectionContract({workspaceId,etag,config,options,provider:'records',limit,cursor,key:null});
 const directory=await registry.directory(),selectedIds=new Set(kind==='projects'?selection.projectIds:selection.notebookIds);
 if(workspaceId!==(scope?directory.projects.find(project=>project.projectId===scope)?.namespaceId:registry.workspaceId))throw new AppError('WORKSPACE_CHANGED');
 const signature=digest(JSON.stringify({kind:'dashboard-choices',scope,...command,cursor:undefined,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),snapshots={directory:directory.revision},selected=[];
 if(session.snapshots?.directory&&session.snapshots.directory!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
 const order=(a,b)=>compareTitles(a.label,b.label)||compareKey(a.value,b.value),point=choice=>choice,page=summaryPage({offset:session.offset,after:session.after,limit,order,point});
 const labels=new Map(),byId=new Map(directory.projects.map(project=>[project.projectId,project]));
 const label=id=>{if(labels.has(id))return labels.get(id);const selectedId=id,names=[],seen=new Set();while(id){if(seen.has(id))throw new AppError('FORMAT');seen.add(id);const project=byId.get(id);if(!project)break;names.unshift(project.summary.title);id=project.parentId;}const value=names.join(' / ');labels.set(selectedId,value);return value;};
 const add=choice=>{if(selectedIds.has(choice.value))selected.push(choice);if(choice.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))page.add(choice);};
 await check();signal?.throwIfAborted();
 if(kind==='projects'){
  const available=projectCollectionScope(directory.projects,{scope,selection:{...selection,scopeMode:'all'}}).projectIds;
  for(const project of directory.projects)if(available.has(project.projectId))add({value:project.projectId,label:label(project.projectId)});
 }else await visit(async(storage,owner,scopeSelection)=>storage.catalogue(async store=>{
  signal?.throwIfAborted();const head=session.snapshots?.[owner.workspaceId]??await store.head();
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');snapshots[owner.workspaceId]=head;
  const snapshot=await store.snapshot(head);if(snapshot.metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
  for(const book of snapshot.metadata.notebooks)if(scopeSelection.projectIds.has(book.projectId??null))add({value:book.id,label:book.title+' / '+(label(book.projectId)||snapshot.metadata.title)});
 }),{workspaceId,scope,selection:{...selection,notebookMode:'all'},signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id))||(await registry.directory()).revision!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
 await check();signal?.throwIfAborted();const result=page.finish(),items=result.records,offset=session.offset,encode=pages.retain(session,snapshots);
 return {workspaceId,etag,items,selected,total:result.total,offset,previousCursor:offset?encode(Math.max(0,offset-limit),offset>limit?result.previousAfter:null):null,nextCursor:offset+items.length<result.total?encode(offset+items.length,result.after):null};
}
