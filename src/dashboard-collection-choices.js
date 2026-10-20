import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {summaryPage} from './summary-page.js';
import {compareTitles,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {dashboardCollectionContract} from './dashboard-collection-contract.js';
// Selectors retain a bounded sorted page and selected labels. Native directory
// rows stream through that page; only the already bounded inline header is merged.
export async function dashboardCollectionChoices(pages,client,command,{scope=null,registry,visit,check,signal}){
 if(!command||Object.keys(command).sort().join()!=='config,cursor,etag,kind,limit,options,search,workspaceId')throw new AppError('INVALID');
 const {workspaceId,etag,config,options,kind,search,limit,cursor}=command;
 if(!['projects','notebooks'].includes(kind)||typeof search!=='string'||search.length>160||limit>25)throw new AppError('INVALID');
 const {selection}=dashboardCollectionContract({workspaceId,etag,config,options,provider:'records',limit,cursor,key:null}),selectedIds=new Set(kind==='projects'?selection.projectIds:selection.notebookIds);
 await check();signal?.throwIfAborted();const metadata=(await registry.workspace.outline()).metadata;if(metadata.id!==registry.workspaceId)throw new AppError('WORKSPACE_CHANGED');
 let directoryRevision,legacyRevision;
 const result=await registry.inspect(async view=>{
  directoryRevision=view.revision;const legacy=[];
  for(const project of metadata.projects)if(!await view.get(project.id))legacy.push({projectId:project.id,parentId:project.parentId??null,summary:{title:project.title,description:project.description??'',kind:project.kind??'Project',templateName:project.labBookTemplate?.name??null},legacy:true});
  legacyRevision=digest(JSON.stringify(legacy));const revision=digest(JSON.stringify([view.revision,legacyRevision])),host=scope?await view.get(scope):null;
  if(workspaceId!==(scope&&host?.state==='active'?host.entry.namespaceId:scope?undefined:registry.workspaceId))throw new AppError('WORKSPACE_CHANGED');
  const signature=digest(JSON.stringify({kind:'dashboard-choices',scope,...command,cursor:undefined,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),snapshots={directory:revision},selected=[];
  if(session.snapshots?.directory&&session.snapshots.directory!==revision)throw new AppError('RECORD_QUERY_CURSOR');
  const order=(a,b)=>compareTitles(a.label,b.label)||compareKey(a.value,b.value),page=summaryPage({offset:session.offset,after:session.after,limit,order,point:choice=>choice}),labels=new Map();
  const ancestors=id=>view.ancestors(id),label=async id=>{
   if(!id)return '';if(labels.has(id))return labels.get(id);let chain;
   try{chain=await ancestors(id);}catch(error){if(error.code!=='NOT_FOUND')throw error;return '';}
   const value=chain.slice().reverse().map(project=>project.summary?.title??project.projectId).join(' / ');if(labels.size>=64)labels.delete(labels.keys().next().value);labels.set(id,value);return value;
  };
  const add=choice=>{if(selectedIds.has(choice.value))selected.push(choice);if(choice.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))page.add(choice);};
  if(kind==='projects'){
   const addProject=async project=>{signal?.throwIfAborted();if(scope&&!(await ancestors(project.projectId)).some(value=>value.projectId===scope))return;add({value:project.projectId,label:await label(project.projectId)});};
   for await(const {entry} of view.entries({index:'active',signal}))await addProject(entry);for(const project of legacy)await addProject(project);
  }else await visit(async(storage,owner,scopeSelection)=>storage.catalogue(async store=>{
   signal?.throwIfAborted();const head=session.snapshots?.[owner.workspaceId]??await store.head();
   if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');snapshots[owner.workspaceId]=head;
   const snapshot=await store.snapshot(head);if(snapshot.metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
   for(const book of snapshot.metadata.notebooks)if(scopeSelection.projectIds.has(book.projectId??null))add({value:book.id,label:book.title+' / '+(await label(book.projectId)||snapshot.metadata.title)});
  }),{workspaceId,scope,selection:{...selection,notebookMode:'all'},signal});
  if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
  const bounded=page.finish(),items=bounded.records,offset=session.offset,encode=pages.retain(session,snapshots);
  return {workspaceId,etag,items,selected,total:bounded.total,offset,previousCursor:offset?encode(Math.max(0,offset-limit),offset>limit?bounded.previousAfter:null):null,nextCursor:offset+items.length<bounded.total?encode(offset+items.length,bounded.after):null};
 });
 if(await registry.version()!==directoryRevision)throw new AppError('RECORD_QUERY_CURSOR');
 // Historical inline identities remain a supported bounded source of labels.
 // Their edits must invalidate a cursor even when the native registry is unchanged.
 const current=(await registry.workspace.outline()).metadata;
 if(current.id!==metadata.id||JSON.stringify(current.projects)!==JSON.stringify(metadata.projects))throw new AppError('RECORD_QUERY_CURSOR');
 await check();signal?.throwIfAborted();return result;
}
