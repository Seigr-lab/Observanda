import {discoveryMatches} from './web/data-discovery.js';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {summaryPage} from './summary-page.js';
import {ProjectModuleQueries} from './project-module-queries.js';
import {moduleDashboardContract} from './module-dashboard-contract.js';
import {dashboardSourceIdentity,dashboardSourceKey} from './web/dashboard-source-key.js';
import {queryResultWindow} from './query-result-window.js';
import {moduleQueryRevision} from './modules/query-source.js';
const compare=(a,b)=>{const x=a.title.toLowerCase(),y=b.title.toLowerCase();return x<y?-1:x>y?1:a.key<b.key?-1:a.key>b.key?1:0;};
const point=row=>({key:row.key,title:row.title});
const identity=(key,workspaceId)=>{const value=dashboardSourceIdentity(key);return dashboardSourceKey(value.workspaceId??workspaceId,value.key);};
// Compose authenticated facts first. Only the visible page opens originals,
// through each owner's domain readers; stock is never merged across owners.
export async function moduleDashboardCollection(pages,client,command,{scope=null,visit,signal}){
 const {source,selection,selected}=moduleDashboardContract(command),{workspaceId,area,type,options,mode,limit,cursor,offset,keys}=command;
 const signature=digest(JSON.stringify({kind:'module-dashboard',scope,...command,cursor:undefined})),session=pages.begin(client,signature,cursor),snapshots={},scopeByOwner=new Map(),seenBooks=new Set(),found=new Set();
 const wanted=keys??selected,identities=wanted&&new Set(wanted.map(key=>identity(key,workspaceId))),pinned=source.key&&identity(command.key,workspaceId);
 const namespaces=pinned?new Set([pinned.split('/')[0]]):identities?new Set([...identities].map(key=>key.split('/')[0])):null;
 const page=summaryPage({offset:session.offset,after:session.after,limit,order:compare,point}),discovered=[];let total=0,scopeProjects={};
 await visit(async(storage,address,selection)=>new ProjectModuleQueries(storage,address.workspaceId).context(area,type,async(c,reader)=>{
  signal?.throwIfAborted();if(c.book.id!==address.workspaceId)throw new AppError('DATABASE_LOCATION');
  const revision=moduleQueryRevision(c);if(Object.hasOwn(snapshots,address.workspaceId)||session.snapshots&&session.snapshots[address.workspaceId]!==revision)throw new AppError('RECORD_QUERY_CURSOR');snapshots[address.workspaceId]=revision;
  scopeProjects=selection.projectLabels;for(const book of c.book.notebooks)seenBooks.add(book.id);
  const owner={...address,projectTitle:address.projectTitle??'',notebookTitle:address.labBookId?c.book.notebooks.find(book=>book.id===address.labBookId)?.title??'':''},scopeIds=address.projectId?null:[...selection.projectIds];scopeByOwner.set(address.workspaceId,scopeIds);
  const collect=view=>{
   const key=dashboardSourceKey(address.workspaceId,view.id);if(pinned&&key!==pinned||identities&&!identities.has(key))return;if(identities)found.add(key);
   const row={...view,key,owner};if(mode==='discovery'){if(!discoveryMatches({title:view.title,subtitle:[owner.projectTitle,owner.notebookTitle].filter(Boolean).join(' / ')},options.search??''))return;if(total++>=offset&&discovered.length<limit)discovered.push(row);}else page.add(row);
  };
  const localKeys=identities&&[...identities].filter(key=>key.startsWith(address.workspaceId+'/')).map(key=>key.split('/')[1]);
  if(mode==='labels'){
   // Selected labels are indexed identity reads, not a second collection scan.
   for(const id of localKeys){signal?.throwIfAborted();const member=await c.member(id);if(member){const view=await c.view(member);if(view.type===type)collect(view);}}
  }else{
   const allLocations=scopeIds?.includes(null)&&c.book.projects.every(project=>scopeIds.includes(project.id));
   await reader.list({workspaceId:address.workspaceId,type,moduleId:area==='planning'?'planning':'resources',scopeIds:allLocations?null:scopeIds,key:pinned?source.key:null,keys:localKeys,query:mode==='discovery'?'':options.search??'',status:options.status??'',...(type==='resource'?{kind:options.kind||null}:{}),limit:1},{signal,consume:async({source:matching,revision,queryHash})=>{
    if(identities||pinned){for await(const view of matching())collect(view);return;}
    const discovery=mode==='discovery',rows=async function*(check){let position=0;for await(const view of matching(check)){
     if(discovery&&!discoveryMatches({title:view.title,subtitle:[owner.projectTitle,owner.notebookTitle].filter(Boolean).join(' / ')},options.search??''))continue;
     yield {...view,key:dashboardSourceKey(address.workspaceId,view.id),...(discovery?{position:position++}:{})};
    }};
    const cacheQuery=digest(JSON.stringify(['module-dashboard',scope,{...command,cursor:undefined,offset:undefined},queryHash,discovery?[owner.projectTitle,owner.notebookTitle]:null]));
    const cached=await queryResultWindow({workspace:storage,ownerId:address.workspaceId,snapshotId:revision,queryHash:cacheQuery,order:discovery?(a,b)=>a.position-b.position:compare,point,after:!discovery&&session.offset?session.after:null,offset:discovery?Math.max(0,offset-total):null,limit:discovery?Math.max(0,limit-discovered.length):limit,preceding:!discovery&&session.offset>limit,reuse:discovery?offset>0:!!cursor,signal},check=>({rows:rows(check)}));
    if(cached){if(discovery){total+=cached.total;discovered.push(...cached.records.map(row=>({...row,owner})));}else page.addIndexed({...cached,records:cached.records.map(row=>({...row,owner}))});}
    else for await(const view of matching())collect(view);
   }});
  }
 },{signal}),{workspaceId,scope,selection,namespaces,includeOwner:owner=>selection.notebookMode!=='selected'||Boolean(owner.labBookId),signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
 if(!namespaces&&selection.notebookMode==='selected'&&selection.notebookIds.some(id=>!seenBooks.has(id)))throw new AppError('RECORD_VIEW_SCOPE');
 if(selected&&mode!=='labels'&&[...identities].some(key=>!found.has(key)))throw new AppError('NOT_FOUND');
 if(mode==='discovery')return {workspaceId,items:discovered.map(row=>({key:row.key,title:row.title,subtitle:[row.owner.projectTitle,row.owner.notebookTitle].filter(Boolean).join(' / ')})),offset,total};
 const result=page.finish(),items=new Map();
 if(mode==='page'&&result.records.length){
  const namespaces=new Set(result.records.map(row=>row.owner.workspaceId));
  await visit(async(storage,owner)=>new ProjectModuleQueries(storage,owner.workspaceId).context(area,type,async(c,_reader,presenter)=>{
   if(moduleQueryRevision(c)!==snapshots[owner.workspaceId])throw new AppError('RECORD_QUERY_CURSOR');
   const rows=result.records.filter(row=>row.owner.workspaceId===owner.workspaceId),values=await presenter.present(c,rows,{type,scopeIds:scopeByOwner.get(owner.workspaceId),signal});
   for(let i=0;i<values.length;i++){const item=values[i],row=rows[i];items.set(row.key,{...item,key:row.key,owner:row.owner,data:{...item.data,owner:owner.projectId?[row.owner.projectTitle,row.owner.notebookTitle].filter(Boolean).join(' / '):item.data.owner},action:{name:'module-open-owned',data:{...item.action.data,workspaceId:owner.workspaceId,projectId:owner.projectId??'',labBookId:owner.labBookId??''}}});}
  },{signal}),{workspaceId,scope,selection,namespaces,signal});
  if(items.size!==result.records.length)throw new AppError('RECORD_QUERY_CURSOR');
 }
 const encode=pages.retain(session,snapshots),next=session.offset+result.records.length;
 return {workspaceId,collection:true,scopeProjects,items:result.records.map(row=>mode==='page'?items.get(row.key):{key:row.key,title:row.title,owner:row.owner}),total:result.total,offset:session.offset,cursor:encode(session.offset,session.after),nextCursor:next<result.total?encode(next,result.after):null,previousCursor:session.offset?encode(Math.max(0,session.offset-limit),result.previousAfter):null,...(mode==='labels'?{missing:keys.filter(key=>!found.has(identity(key,workspaceId)))}:{})};
}
