import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {summaryPage} from './summary-page.js';
import {Laboratory} from './laboratory.js';
import {SampleAnalysisReader} from './sample-analysis-reader.js';
import {researchId} from './web/research-reference.js';
import {defaultDashboard,createPanel,validDashboard} from './web/dashboard-model.js';
import {dashboardSelection} from './web/dashboard-scope.js';
import {dashboardSourceIdentity,dashboardSourceKey} from './web/dashboard-source-key.js';
const counts=()=>({samples:0,analyses:0,review:0,archive:0,approved:0,events:0});
const order=(a,b)=>a.owner.workspaceId<b.owner.workspaceId?-1:a.owner.workspaceId>b.owner.workspaceId?1:a.id<b.id?-1:a.id>b.id?1:0;
const point=row=>({owner:{workspaceId:row.owner.workspaceId},id:row.id});
export async function sampleAnalysisCollection(pages,client,command,{scope=null,visit,signal}){
 if(!command||Object.keys(command).sort().join()!=='config,cursor,key,limit,mode,offset,options,view,workspaceId')throw new AppError('INVALID');
 const {workspaceId,view,config,options,mode,limit,offset,cursor,key}=command,source=dashboardSourceIdentity(key);
 if(!researchId(workspaceId)||!['samples','all','events'].includes(view)||!['page','discovery','counts'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(offset)||offset<0||mode!=='discovery'&&offset!==0||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096)||!source||source.key&&!researchId(source.key))throw new AppError('INVALID');
 const settings=defaultDashboard();settings.views[0].panels=[{...createPanel('records','query'),config,options}];if(!validDashboard(settings)||typeof (options.search??'')!=='string'||(options.search??'').length>256)throw new AppError('INVALID');
 if(config.workspaceId&&config.workspaceId!==workspaceId)throw new AppError('RECORD_VIEW_SCOPE');
 const oldBook=options.notebookId??config.notebookId,selection={...dashboardSelection(options,config),notebookMode:options.notebookMode??(oldBook?'selected':'all'),notebookIds:options.notebookIds??(oldBook?[oldBook]:[])};
 const signature=digest(JSON.stringify({kind:'sample-analysis',scope,...command,cursor:undefined})),session=pages.begin(client,signature,cursor),snapshots={},seenBooks=new Set(),totals=counts(),pinned=source.key?dashboardSourceKey(source.workspaceId??workspaceId,source.key):null;
 const page=summaryPage({offset:session.offset,after:session.after,limit,order,point}),discovered=[];let total=0,scopeProjects={};
 const namespaces=pinned?new Set([source.workspaceId??workspaceId]):null;
 await visit(async(storage,address,selected)=>{
  scopeProjects=selected?.projectLabels??scopeProjects;const outline=await storage.outline();if(outline.metadata.id!==address.workspaceId)throw new AppError('DATABASE_LOCATION');for(const book of outline.metadata.notebooks)seenBooks.add(book.id);
  const owner={...address,projectTitle:address.projectTitle??(!address.projectId?outline.metadata.title:''),notebookTitle:address.labBookId?outline.metadata.notebooks.find(book=>book.id===address.labBookId)?.title??'':''};
  const reader=new SampleAnalysisReader(new Laboratory(storage)),result=await reader.query({workspaceId:address.workspaceId,view,search:options.search??'',limit:1,key:source.key??null},{signal,...(mode==='counts'?{}:{collect:row=>{
   const collectionKey=dashboardSourceKey(address.workspaceId,row.id);if(pinned&&collectionKey!==pinned)return;const value={...row,collectionKey,owner};
   if(mode==='discovery'){if(total++>=offset&&discovered.length<limit)discovered.push(value);}else page.add(value);
  }})});
  if(Object.hasOwn(snapshots,address.workspaceId)||session.snapshots&&session.snapshots[address.workspaceId]!==result.etag)throw new AppError('RECORD_QUERY_CURSOR');snapshots[address.workspaceId]=result.etag;
  for(const key of Object.keys(totals))totals[key]+=result.counts[key];
 },{workspaceId,scope,selection,namespaces,includeOwner:owner=>selection.notebookMode!=='selected'||Boolean(owner.labBookId),signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
 if(!namespaces&&selection.notebookMode==='selected'&&selection.notebookIds.some(id=>!seenBooks.has(id)))throw new AppError('RECORD_VIEW_SCOPE');
 if(mode!=='page')return {workspaceId,collection:true,view,scopeProjects,items:discovered,total,offset,counts:totals};
 const result=page.finish();
 // Only visible sample rows need their related-analysis count. No original
 // result bodies or growing histories are assembled to render these cards.
 if(['samples','events'].includes(view)&&result.records.length)await visit(async(storage,address)=>{
  const reader=new SampleAnalysisReader(new Laboratory(storage));
  const rows=result.records.filter(row=>row.owner.workspaceId===address.workspaceId);
  const indexed=await reader.indexed(address.workspaceId,null,async(owner,source)=>{
   if(source.etag!==snapshots[address.workspaceId])throw new AppError('RECORD_QUERY_CURSOR');
   for(const row of rows){
    if(view==='events'){row.recordKind=await owner.member(source.head,'sample',row.recordId)?'sample':'analysis';continue;}
    const member=await owner.member(source.head,'sample',row.id);if(!member)throw new AppError('RECORD_QUERY_CURSOR');Object.assign(row,await owner.summary(source.head,member));
   }return true;
  },{signal});
  if(indexed===null&&view==='events'){const current=await reader.source(address.workspaceId,null,{signal});if(current.etag!==snapshots[address.workspaceId])throw new AppError('RECORD_QUERY_CURSOR');const samples=new Set(current.lab.samples.map(s=>s.id));for(const row of rows)row.recordKind=samples.has(row.recordId)?'sample':'analysis';}
 },{workspaceId,scope,selection,namespaces:new Set(result.records.map(row=>row.owner.workspaceId)),signal});
 const encode=pages.retain(session,snapshots),next=session.offset+result.records.length;
 return {workspaceId,collection:true,view,scopeProjects,items:result.records,counts:totals,total:result.total,offset:session.offset,cursor:encode(session.offset,session.after),nextCursor:next<result.total?encode(next,result.after):null,previousCursor:session.offset?encode(Math.max(0,session.offset-limit),result.previousAfter):null};
}
