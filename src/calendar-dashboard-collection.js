import {date} from './modules/validation.js';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {summaryPage} from './summary-page.js';
import {researchId} from './web/research-reference.js';
import {defaultDashboard,createPanel,validDashboard} from './web/dashboard-model.js';
import {dashboardSelection} from './web/dashboard-scope.js';
import {calendarCollectionIdentity} from './web/modules/calendar-collection.js';
const point=event=>({key:event.collectionKey,startsAt:event.startsAt,title:event.title});
const order=(a,b)=>a.startsAt.localeCompare(b.startsAt)||a.title.localeCompare(b.title)||(a.key??a.collectionKey).localeCompare(b.key??b.collectionKey);
// Calendar providers stream their own authenticated schedule facts and feeds.
// This reducer retains only one combined page and owner version fingerprints.
export async function calendarDashboardCollection(pages,client,command,{scope=null,visit,read,signal}){
 if(!command||Object.keys(command).sort().join()!=='config,cursor,from,key,limit,mode,offset,options,search,timeZone,to,workspaceId')throw new AppError('INVALID');
 const {workspaceId,config,options,mode,cursor,limit,key,offset,search,from,to,timeZone}=command,pinned=calendarCollectionIdentity(key,workspaceId);
 if(!researchId(workspaceId)||!['agenda','discovery'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(offset)||offset<0||mode!=='discovery'&&offset!==0||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096)||!pinned||typeof search!=='string'||search.length>256)throw new AppError('INVALID');
 if(!date(from)||!date(to)||from>=to||Date.parse(to)-Date.parse(from)>93*86400000)throw new AppError('INVALID');try{new Intl.DateTimeFormat('en',{timeZone});}catch{throw new AppError('INVALID');}
 const settings=defaultDashboard();settings.views[0].panels=[{...createPanel('calendar-agenda','query'),config,options}];if(!validDashboard(settings))throw new AppError('INVALID');
 if(config.workspaceId&&config.workspaceId!==workspaceId)throw new AppError('RECORD_VIEW_SCOPE');
 const oldBook=options.notebookId??config.notebookId,selection={...dashboardSelection(options,config),notebookMode:options.notebookMode??(oldBook?'selected':'all'),notebookIds:options.notebookIds??(oldBook?[oldBook]:[])};
 const signature=digest(JSON.stringify({kind:'calendar-dashboard',scope,...command,cursor:undefined})),session=pages.begin(client,signature,cursor),snapshots={},seen=new Set(),errors=[],found=[],page=summaryPage({offset:session.offset,after:session.after,limit,order,point});let total=0,scopeProjects={};
 await visit(async(storage,address,selected)=>{
  const {metadata:book}=await storage.outline();if(book.id!==address.workspaceId)throw new AppError('DATABASE_LOCATION');for(const item of book.notebooks)seen.add(item.id);scopeProjects=selected.projectLabels;
  const owner={...address,projectTitle:address.projectTitle??'',notebookTitle:address.labBookId?book.notebooks.find(item=>item.id===address.labBookId)?.title??'':''};
  const result=await read(storage,address,{workspaceId:address.workspaceId,from,to,timeZone,mode:'discovery',scopeIds:address.projectId?null:[...selected.projectIds],search,limit:1},{signal,collect:event=>{
   const collectionKey=address.workspaceId+'/'+digest(JSON.stringify([event.sourceId,event.id]));
   if(pinned.key&&(pinned.legacy?event.sourceId+':'+event.id!==pinned.key:collectionKey!==key))return;
   const value={...event,collectionKey,owner};if(mode==='discovery'){if(total++>=offset&&found.length<limit)found.push(value);}else page.add(value);
  }});
  if(Object.hasOwn(snapshots,address.workspaceId)||session.snapshots&&session.snapshots[address.workspaceId]!==result.version)throw new AppError('RECORD_QUERY_CURSOR');snapshots[address.workspaceId]=result.version;
  for(const error of result.sourceErrors)if(errors.length<30)errors.push(error);
 },{workspaceId,scope,selection,namespaces:pinned.key?new Set([pinned.workspaceId]):null,includeOwner:owner=>selection.notebookMode!=='selected'||Boolean(owner.labBookId),signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
 if(!pinned.key&&selection.notebookMode==='selected'&&selection.notebookIds.some(id=>!seen.has(id)))throw new AppError('RECORD_VIEW_SCOPE');
 if(mode==='discovery')return {workspaceId,collection:true,events:found,total,offset,sourceErrors:errors,scopeProjects};
 const result=page.finish(),encode=pages.retain(session,snapshots),next=session.offset+result.records.length;
 return {workspaceId,collection:true,events:result.records,total:result.total,offset:session.offset,cursor:encode(session.offset,session.after),nextCursor:next<result.total?encode(next,result.after):null,previousCursor:session.offset?encode(Math.max(0,session.offset-limit),result.previousAfter):null,sourceErrors:errors,scopeProjects};
}
