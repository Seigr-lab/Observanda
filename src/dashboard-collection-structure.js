import {configurationProfileBooks,configurationProfileSummary} from './configuration-profiles.js';
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {summaryPage} from './summary-page.js';
import {compareTitles,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {dashboardCollectionContract} from './dashboard-collection-contract.js';
import {dashboardSourceKey} from './web/dashboard-source-key.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {catalogueOutline} from './catalogue-outline.js';
import {labRecordProvider} from './web/laboratory/data-scope.js';
import {discoveryMatches} from './web/data-discovery.js';

export const dashboardStructureProvider=provider=>['projects','notebooks','workspace'].includes(provider)||typeof provider==='string'&&provider.endsWith('-spaces')&&Boolean(labRecordProvider(provider.replace(/-spaces$/,'-records')));
// Structural cards compose authenticated metadata and indexed counts. Original
// record bodies never participate in project or book discovery.
export async function dashboardCollectionStructure(pages,client,command,{scope=null,visit,signal,discovery=null}){
 const {selection,source}=dashboardCollectionContract({...command,provider:'records'}),{provider,workspaceId,etag,key,limit,cursor,options}=command;
 if(!dashboardStructureProvider(provider))throw new AppError('INVALID');
 const lab=labRecordProvider(provider.replace(/-spaces$/,'-records'));
 const signature=digest(JSON.stringify({kind:'dashboard-structure',discovery:Boolean(discovery),scope,...command,cursor:undefined,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),snapshots={},seenBooks=new Set();
 const order=(a,b)=>compareTitles(a.title,b.title)||compareKey(a.key,b.key),point=({key,title})=>({key,title}),page=summaryPage({offset:session.offset,after:session.after,limit,order,point}),discovered=[];let display=null,totalRecords=0,discoveryTotal=0;
 const accepts=item=>(!key||item.key===key||!source.workspaceId&&item.key===dashboardSourceKey(workspaceId,source.key))&&discoveryMatches(item,options.search??'');
 const add=item=>{if(!accepts(item))return;if(!discovery){page.add(item);return;}if(discoveryTotal>=discovery.offset&&discovered.length<limit)discovered.push({key:item.key,title:item.title,...(item.subtitle?{subtitle:item.subtitle}:{})});discoveryTotal++;};
 const action=(owner,kind,id)=>({name:'research-open-owned',data:{workspaceId:owner.workspaceId,kind,id}});
 let scopeProjects={};
 await visit(async(storage,owner,selected)=>storage.catalogue(async store=>{
  scopeProjects=selected.projectLabels??{};
  signal?.throwIfAborted();const head=session.snapshots?.[owner.workspaceId]??await store.head();
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');snapshots[owner.workspaceId]=head;
  const snapshot=await store.snapshot(head),metadata=snapshot.metadata;if(metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
  if(owner.workspaceId===workspaceId)display=metadata;
  const books=metadata.notebooks.filter(book=>selected.projectIds.has(book.projectId??null)&&(!selected.notebookIds||selected.notebookIds.has(book.id)));for(const book of books)seenBooks.add(book.id);
  if(provider==='projects'){
   const directory=storage.projectId?await new LabBookRegistry(storage).inspect(async view=>{
    const masked=new Set();for(const book of metadata.notebooks)if(await view.get(book.id))masked.add(book.id);
    return {revision:view.revision,total:view.count,books:(await view.page({limit:12,signal})).items.map(row=>row.entry),masked};
   }):{revision:'empty',total:0,books:[],masked:new Set()},registered=directory.books,retiredOrDedicated=directory.masked;
   const stamp=directory.revision,stampKey='books:'+owner.workspaceId;if(session.snapshots&&session.snapshots[stampKey]!==stamp)throw new AppError('RECORD_QUERY_CURSOR');snapshots[stampKey]=stamp;
   // Membership identifies the authoritative owner, including retired projects.
   // Retained source metadata must never create a second navigation target.
   const projectOwner=owner.projectId?owner.workspaceId:null;
   for(const project of metadata.projects.filter(project=>selected.projectIds.has(project.id)&&selected.projectOwners.get(project.id)===projectOwner)){
    const local=metadata.notebooks.filter(book=>book.projectId===project.id&&!retiredOrDedicated.has(book.id)),independent=storage.projectId===project.id?registered:[],notebooks=[...local.slice(0,12).map(book=>({id:book.id,title:book.title,route:{action:'research-open-owned',workspaceId:owner.workspaceId,kind:'notebook',id:book.id}})),...independent.slice(0,Math.max(0,12-local.length)).map(book=>({id:book.labBookId,title:book.directory,route:{action:'research-open-owned',workspaceId:book.namespaceId,kind:'notebook',id:book.labBookId}}))];
    add({key:dashboardSourceKey(owner.workspaceId,project.id),title:project.title,owner:{...owner,projectTitle:project.title,notebookTitle:''},data:{...project,notebooks,notebookTotal:local.length+(storage.projectId===project.id?directory.total:0)},action:action(owner,'project',project.id)});
   }
   return;
  }
  const counts=await catalogueOutline(store,snapshot,{signal});
  for(const book of books)totalRecords+=counts.notebookCounts[book.id];
  if(provider==='workspace')return;
  for(const book of lab?await configurationProfileBooks(store,metadata,books,lab.profile,{signal}):books){
   const project=metadata.projects.find(project=>project.id===book.projectId),itemOwner={...owner,projectTitle:owner.projectTitle??project?.title??'',notebookTitle:book.title};
   add({key:dashboardSourceKey(owner.workspaceId,book.id),title:book.title,subtitle:itemOwner.projectTitle,owner:itemOwner,data:{...book,projectIds:[book.projectId],location:itemOwner.projectTitle,...await configurationProfileSummary(store,metadata,book,{signal}),count:counts.notebookCounts[book.id]},action:action(owner,'notebook',book.id)});
  }
 }),{workspaceId,scope,selection,signal,includeBooks:provider!=='projects'});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
 if(provider!=='projects'&&!key&&selection.notebookMode==='selected'&&selection.notebookIds.some(id=>!seenBooks.has(id)))throw new AppError('RECORD_VIEW_SCOPE');
 if(provider==='workspace'){
  if(!display)throw new AppError('RECORD_VIEW_SCOPE');
  add({key:workspaceId,title:display.title,data:{id:display.id,title:display.title,description:display.description,entries:totalRecords}});
 }
 if(discovery)return {workspaceId,etag,provider,items:discovered,total:discoveryTotal,offset:discovery.offset,cursor:pages.retain(session,snapshots)(0,null)};
 const result=page.finish(),offset=session.offset,items=result.records,encode=pages.retain(session,snapshots);
 return {workspaceId,etag,collection:true,scopeProjects,items,total:result.total,offset,cursor:encode(offset,session.after),previousCursor:offset?encode(Math.max(0,offset-limit),offset>limit?result.previousAfter:null):null,nextCursor:offset+items.length<result.total?encode(offset+items.length,result.after):null};
}
