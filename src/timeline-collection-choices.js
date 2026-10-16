import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {summaryPage} from './summary-page.js';
import {researchId} from './web/research-reference.js';
import {compareTitles,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {timelineSourceKey,validTimelineSource} from './web/tools/timeline-source.js';
import {projectCollectionScope} from './project-collection-scope.js';
export async function timelineCollectionChoices(pages,client,command,{scope=null,registry,visit,check,signal}){
 if(!command||Object.keys(command).sort().join()!=='cursor,kind,limit,search,selected,workspaceId')throw new AppError('INVALID');
 const {workspaceId,kind,search,selected,limit,cursor}=command;
 if(!researchId(workspaceId)||!['projects','books'].includes(kind)||typeof search!=='string'||search.length>160||!Array.isArray(selected)||selected.length>500||!selected.every(validTimelineSource)||new Set(selected).size!==selected.length||!Number.isInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw new AppError('INVALID');
 const directory=await registry.directory(),selection={scopeMode:'all',projectIds:[],includeWorkspace:!scope,notebookMode:'all'},available=projectCollectionScope(directory.projects,{scope,selection}).projectIds;
 if(workspaceId!==(scope?directory.projects.find(project=>project.projectId===scope)?.namespaceId:registry.workspaceId))throw new AppError('WORKSPACE_CHANGED');
 const signature=digest(JSON.stringify({kind:'timeline-choices',scope,...command,selected:undefined,cursor:undefined,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),snapshots={directory:directory.revision},chosen=[];
 if(session.snapshots&&session.snapshots.directory!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
 const page=summaryPage({offset:session.offset,after:session.after,limit,order:(a,b)=>compareTitles(a.label,b.label)||compareKey(a.value,b.value),point:value=>value}),byId=new Map(directory.projects.map(p=>[p.projectId,p]));
 const label=id=>{const names=[],seen=new Set();while(id){if(seen.has(id))throw new AppError('FORMAT');seen.add(id);const p=byId.get(id);if(!p)break;names.unshift(p.summary.title);id=p.parentId;}return names.join(' / ');};
 const add=item=>{if(selected.includes(item.value))chosen.push(item);if(item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))page.add(item);};
 await check();signal?.throwIfAborted();
 if(kind==='projects')for(const project of directory.projects){if(available.has(project.projectId))add({value:timelineSourceKey(project.namespaceId??registry.workspaceId,project.projectId,workspaceId),label:label(project.projectId)});}
 else await visit(async(storage,owner)=>storage.catalogue(async store=>{
  const snapshotId=session.snapshots?.[owner.workspaceId]??await store.head();
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');snapshots[owner.workspaceId]=snapshotId;
  const snapshot=await store.snapshot(snapshotId);if(snapshot.metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
  for(const book of snapshot.metadata.notebooks)if(available.has(book.projectId??null))add({value:timelineSourceKey(owner.workspaceId,book.id,workspaceId),label:book.title+(owner.workspaceId===workspaceId?'':' / '+(label(book.projectId)||snapshot.metadata.title))});
 }),{workspaceId,scope,selection,signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id))||(await registry.directory()).revision!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
 await check();signal?.throwIfAborted();const result=page.finish(),offset=session.offset,items=result.records,encode=pages.retain(session,snapshots);
 return {workspaceId,items,selected:chosen,total:result.total,offset,previousCursor:offset?encode(offset-limit,offset>limit?result.previousAfter:null):null,nextCursor:offset+items.length<result.total?encode(offset+items.length,result.after):null};
}
