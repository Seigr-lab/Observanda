// Structural cards in one authenticated owner use bounded projections, including
// referenced lab-book configurations. No configuration tree enters a response.
import {configurationProfileBooks,configurationProfileSummary} from './configuration-profiles.js';
import {dashboardCollectionContract} from './dashboard-collection-contract.js';
import {dashboardStructureProvider} from './dashboard-collection-structure.js';
import {catalogueOutline} from './catalogue-outline.js';
import {summaryPage} from './summary-page.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {queryPanel} from './web/dashboard-queries.js';
import {labRecordProvider} from './web/laboratory/data-scope.js';
import {discoveryMatches} from './web/data-discovery.js';
import {compareTitles,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {researchId} from './web/research-reference.js';

async function* rows(store,snapshot,command,{signal,details=false,selected=null}={}){
 const {provider,config,options,key}=command,metadata=snapshot.metadata,scope=queryPanel(metadata,{config,options});
 if(scope.unavailable)throw new AppError('RECORD_VIEW_SCOPE');
 const lab=labRecordProvider(provider.replace(/-spaces$/,'-records'));
 const accepts=item=>(!selected||selected.has(item.key))&&(key===null||item.key===key)&&discoveryMatches(item,options.search??'');
 if(provider==='workspace'){
  const item={key:metadata.id,title:metadata.title,data:{id:metadata.id,title:metadata.title,description:metadata.description}};
  if(accepts(item)){if(details)item.data.entries=(await catalogueOutline(store,snapshot,{signal})).total;yield item;}return;
 }
 if(provider==='projects'){
  for(const project of scope.projects){
   signal?.throwIfAborted();const item={key:project.id,title:project.title,action:{name:'open-project',id:project.id}};if(!accepts(item))continue;
   if(details){const books=scope.notebooks.filter(book=>book.projectId===project.id);item.data={...project,notebooks:books.slice(0,12).map(book=>({id:book.id,title:book.title,route:{action:'filter-notebook',id:book.id}})),notebookTotal:books.length};}yield item;
  }return;
 }
 for(const book of lab?await configurationProfileBooks(store,metadata,scope.notebooks,lab.profile,{signal}):scope.notebooks){
  signal?.throwIfAborted();const project=metadata.projects.find(project=>project.id===book.projectId),item={key:book.id,title:book.title,subtitle:project?.title??'',action:{name:'filter-notebook',id:book.id}};if(!accepts(item))continue;
  if(details)item.data={...book,projectIds:[book.projectId],location:project?.title??'',...await configurationProfileSummary(store,metadata,book,{signal})};yield item;
 }
}
export async function dashboardOwnerStructure(store,snapshot,command,{signal}={}){
 dashboardCollectionContract({...command,provider:'records'});
 const {workspaceId,etag,provider,limit,cursor}=command;
 if(!dashboardStructureProvider(provider)||snapshot.metadata.id!==workspaceId)throw new AppError('INVALID');
 const signature=digest(serialize({kind:'owner-structure',order:QUERY_ORDER_VERSION,...command,cursor:undefined}));let anchor={signature,offset:0,after:null};
 if(cursor){try{anchor=store.decode('dashboard-structure-page',workspaceId,Buffer.from(cursor,'base64url'));}catch(error){if(error.code==='ACCESS_LOCKED')throw error;throw new AppError('RECORD_QUERY_CURSOR');}}
 if(!anchor||anchor.signature!==signature||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||(anchor.offset===0?anchor.after!==null:!researchId(anchor.after?.key)||typeof anchor.after?.title!=='string'))throw new AppError('RECORD_QUERY_CURSOR');
 const order=(a,b)=>compareTitles(a.title,b.title)||compareKey(a.key,b.key),page=summaryPage({...anchor,limit,order,point:({key,title})=>({key,title})});
 for await(const item of rows(store,snapshot,command,{signal}))page.add(item);
 const result=page.finish(),wanted=new Set(result.records.map(item=>item.key)),items=new Map();
 // Only selected cards receive profile summaries and record counts.
 for await(const item of rows(store,snapshot,command,{signal,details:true,selected:wanted}))items.set(item.key,item);
 if(provider==='notebooks'||provider.endsWith('-spaces')){const counts=await catalogueOutline(store,snapshot,{signal});for(const item of items.values())item.data.count=counts.notebookCounts[item.key];}
 const encode=(offset,after)=>store.encode('dashboard-structure-page',workspaceId,{signature,offset,after}).toString('base64url');
 return {workspaceId,etag,items:result.records.map(item=>items.get(item.key)),total:result.total,offset:anchor.offset,cursor:encode(anchor.offset,anchor.after),previousCursor:anchor.offset?encode(Math.max(0,anchor.offset-limit),anchor.offset>limit?result.previousAfter:null):null,nextCursor:anchor.offset+result.records.length<result.total?encode(anchor.offset+result.records.length,result.after):null};
}
export async function dashboardOwnerDiscovery(store,snapshot,command,{signal}={}){
 const {workspaceId,etag,provider,search,offset,limit}=command,items=[];let total=0;
 for await(const item of rows(store,snapshot,{...command,options:{search},key:null},{signal})){
  if(total>=offset&&items.length<limit)items.push({key:item.key,title:item.title,...(item.subtitle?{subtitle:item.subtitle}:{})});total++;
 }
 return {workspaceId,etag,provider,items,total,offset};
}
