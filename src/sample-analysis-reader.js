// Browse native summaries in bounded pages from the samples domain's indexes.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {SampleAnalysisCatalogue} from './sample-analysis-catalogue.js';
import {resolveSampleSource} from './sample-result-sources.js';
const invalid=()=>{throw new AppError('INVALID');};
const etagValid=value=>value===null||value==='new'||revisionId(value);
const views=['samples','analyses','review','archive','all','events'];
export class SampleAnalysisReader{
 constructor(laboratory){this.laboratory=laboratory;}
 async resultSource(command,{signal}={}){
  if(!command||Object.keys(command).length!==3||!researchId(command.workspaceId))invalid();
  const workspace=this.laboratory.workspace;
  const read=async()=>{
   signal?.throwIfAborted();
   const current=await workspace.catalogue(async store=>(await store.snapshot()).metadata.id);
   if(current!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   return resolveSampleSource(workspace,command.role,command.source,{signal});
  };
  return workspace.withCatalogueConnections?workspace.withCatalogueConnections(read):read();
 }
 async indexed(workspaceId,etag,operation,{signal}={}){
  if(!researchId(workspaceId)||!etagValid(etag))invalid();signal?.throwIfAborted();
  return this.laboratory.catalogue(async store=>{
   if((store.namespaceId??(await store.snapshot()).metadata.id)!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const owner=new SampleAnalysisCatalogue(store),source=await owner.source(etag);signal?.throwIfAborted();
   return operation(owner,source);
  },{signal});
 }
 async query(command,{signal,collect,consume}={}){
  if(!command||Object.keys(command).some(k=>!['workspaceId','view','search','sampleId','recordId','key','cursor','offset','limit'].includes(k)))invalid();
  const {workspaceId,view='samples',search='',sampleId=null,recordId=null,key=null,cursor=null,limit=25}=command;let offset=command.offset??0,etag=null;
  if(!views.includes(view)||typeof search!=='string'||search.length>512||![sampleId,recordId,key].every(id=>id===null||researchId(id))||!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)invalid();
  const query=digest(serialize({workspaceId,view,search,sampleId,recordId,key,limit}));
  // This cursor is a position in an already-authorized private collection,
  // not an authorization token. Every request checks workspace and source.
  if(cursor!==null){
   if(typeof cursor!=='string'||cursor.length>1024||command.offset!==undefined)invalid();
   let value;try{value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{invalid();}
   if(!value||value.query!==query||!etagValid(value.etag)||value.etag===null||!Number.isSafeInteger(value.offset)||value.offset<0)invalid();
   ({offset,etag}=value);
  }
  const indexed=await this.indexed(workspaceId,etag,async(owner,source)=>{
   const read=(collect,sourceSignal=signal)=>owner.query(source,{view,search,sampleId,recordId,key,offset,limit,signal:sourceSignal,collect});
   return consume?{consumed:true,value:await consume({etag:source.etag,counts:source.head.counts,read})}:{...await read(collect),etag:source.etag};
  },{signal});
  return indexed.consumed?indexed.value:this.page({workspaceId,view,query,offset,limit,...indexed});
 }
 page({workspaceId,view,query,offset,limit,items,counts,total,etag}){
  const at=Math.min(offset,Math.max(0,total)),encode=position=>Buffer.from(JSON.stringify({query,etag,offset:position})).toString('base64url');
  return {workspaceId,etag,view,items,counts,total,offset:at,cursor:encode(at),previousCursor:at?encode(Math.max(0,at-limit)):null,nextCursor:at+items.length<total?encode(at+items.length):null};
 }
 async selected(command,options){
  if(!command||Object.keys(command).some(k=>!['workspaceId','etag','id','kind'].includes(k))||!researchId(command.id)||!['sample','analysis'].includes(command.kind))invalid();
  const indexed=await this.indexed(command.workspaceId,command.etag??null,async(owner,source)=>({workspaceId:command.workspaceId,etag:source.etag,...await owner.selected(source,command.kind,command.id)}),options);
  return indexed;
 }
}
