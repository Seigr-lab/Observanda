import {AppError} from './errors.js';
import {ownerSourceDirectory} from './owner-source-directory.js';
import {createComparisonSourceAccess} from './comparison-source-access.js';
import {ResearchMaterials} from './research-materials.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {materialRecordSummary} from './material-record-summary.js';
import {moduleReferenceQuery} from './module-reference-query.js';
import {materialKinds,validMaterialReference,materialReference} from './web/material-reference.js';
import {exact} from './modules/validation.js';
import {researchId} from './web/research-reference.js';
export async function comparisonSourceDiscovery(application,client,workspace,operation,data,{scope=null,labBookId=null,check=async()=>{},signal}={}){
 const workspaceId=(await workspace.outline()).metadata.id;if(data.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
 if(operation==='source-owners'){
  const page=await ownerSourceDirectory(application,client,data,{scope,labBookId,check,signal,includeHost:true});
  return {...page,items:page.items.map(item=>({...item,kind:item.kind==='content'?'project':item.kind==='book'?'lab-book':item.kind}))};
 }
 const access=await createComparisonSourceAccess(application,client,{workspace,check,signal});
 try{
  if(operation==='source-resolve'){
   if(!exact(data,['workspaceId','ref'])||!validMaterialReference(data.ref)||!researchId(data.ref.workspaceId))throw new AppError('INVALID');
   const result=await access.use(data.ref,async(storage,canonical,{owner})=>{
    const title=canonical.kind==='record'?await new RetainedRecordDocuments(storage).open(canonical,async document=>(await document.field(['title'])).value,{history:true,signal,legacy:value=>value.title}):(await new ResearchMaterials(storage).read(canonical)).title;
    return {workspaceId,reference:materialReference(data.ref),owner,title};
   });await access.verify();return result;
  }
  if(operation!=='source-items'||!exact(data,['workspaceId','sourceId','kind','query','cursor','limit'])||!researchId(data.sourceId)||!['record',...materialKinds].includes(data.kind)||typeof data.query!=='string'||data.query.length>160||!Number.isSafeInteger(data.limit)||data.limit<1||data.limit>25||data.cursor!==null&&(typeof data.cursor!=='string'||data.cursor.length>8192))throw new AppError('INVALID');
  const page=await access.selected(data.sourceId,async(storage,{owner,store,snapshot})=>{
   if(data.kind==='record'){
    const page=await moduleReferenceQuery(store,snapshot,{workspaceId,sourceId:data.sourceId,types:['record'],query:data.query,cursor:data.cursor,limit:data.limit},{signal}),items=[];
    for(const item of page.items){signal?.throwIfAborted();const value=await materialRecordSummary(store,await store.member(snapshot,item.id));items.push({reference:{workspaceId:data.sourceId,kind:'record',id:value.id,revision:value.revision},title:value.title});}
    return {workspaceId,sourceId:data.sourceId,owner,items,next:page.nextCursor,changed:false,scanned:page.items.length};
   }
   const materials=new ResearchMaterials(storage);
   if(!await materials.index.state()){
    const existing=await store.objectIdPage('metadata:.observanda/materials/objects/');
    if(existing.items.length)throw new AppError('ACCESS_UPGRADE');
    return {workspaceId,sourceId:data.sourceId,owner,items:[],next:null,changed:false,scanned:0};
   }
   const page=await materials.index.page({kind:data.kind,query:data.query,cursor:data.cursor,limit:data.limit,signal},{initialize:false});
   return {...page,workspaceId,sourceId:data.sourceId,owner,items:page.items.map(item=>({reference:materialReference({...item,workspaceId:data.sourceId}),title:item.title}))};
  });await access.verify();return page;
 }finally{await access.close();}
}
