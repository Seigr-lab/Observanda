import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {summaryPage} from './summary-page.js';
import {compareTitles,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {researchId} from './web/research-reference.js';
// Website discovery returns owner addresses and labels. Publication drafts,
// credentials, private research and destination settings remain with each owner.
export async function publicationSiteDirectory(pages,client,command,{scope=null,visit,signal}){
 if(!command||Object.keys(command).sort().join()!=='cursor,limit,projectId,search,workspaceId')throw new AppError('INVALID');
 const {workspaceId,projectId,search,limit,cursor}=command;
 if(!researchId(workspaceId)||projectId!==null&&!researchId(projectId)||typeof search!=='string'||search.length>160||!Number.isSafeInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw new AppError('INVALID');
 const signature=digest(JSON.stringify({kind:'publication-sites',scope,...command,cursor:undefined,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),snapshots={};
 const page=summaryPage({offset:session.offset,after:session.after,limit,order:(a,b)=>compareTitles(a.name,b.name)||compareKey(a.key,b.key),point:({key,name})=>({key,name})});
 await visit(async(storage,owner,localProjectId)=>storage.catalogue(async store=>{
  signal?.throwIfAborted();const head=session.snapshots?.[owner.workspaceId]??await store.head();
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');snapshots[owner.workspaceId]=head;
  const snapshot=await store.snapshot(head),metadata=snapshot.metadata;if(metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
  const selected=new Set(localProjectId?[localProjectId]:metadata.projects.map(project=>project.id));for(let more=true;more;){more=false;for(const p of metadata.projects)if(selected.has(p.parentId)&&!selected.has(p.id)){selected.add(p.id);more=true;}}
  const ownerLabel=owner.labBookId?[owner.projectTitle,metadata.notebooks.find(book=>book.id===owner.labBookId)?.title??metadata.title].filter(Boolean).join(' / '):owner.projectTitle??metadata.title;
  const add=(siteId,name)=>{const item={key:owner.workspaceId+'/'+(siteId??'default'),workspaceId:owner.workspaceId,projectId:owner.projectId,labBookId:owner.labBookId,siteId,name,ownerLabel};if((name+' '+ownerLabel).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))page.add(item);};
  if(!localProjectId)add(null,metadata.title);
  for(const site of metadata.websites??[])if(site.projectId===null&&!localProjectId||selected.has(site.projectId))add(site.id,site.name);
 }),{workspaceId,query:{projectId},scope,signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
 signal?.throwIfAborted();const result=page.finish(),items=result.records,offset=session.offset,encode=pages.retain(session,snapshots);
 return {workspaceId,items,total:result.total,offset,previousCursor:offset?encode(offset-limit,offset>limit?result.previousAfter:null):null,nextCursor:offset+items.length<result.total?encode(offset+items.length,result.after):null};
}
