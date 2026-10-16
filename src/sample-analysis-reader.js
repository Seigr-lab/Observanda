// The legacy sample-analysis store has a qualified 16 MiB operating limit.
// Its read boundary returns one projection page or one selected original;
// clients never need the complete store or event chain to browse it.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {SampleAnalysisCatalogue} from './sample-analysis-catalogue.js';
const invalid=()=>{throw new AppError('INVALID');};
const etagValid=value=>value===null||value==='new'||revisionId(value);
const views=['samples','analyses','review','archive','all','events'];
export class SampleAnalysisReader{
 constructor(laboratory){this.laboratory=laboratory;}
 async indexed(workspaceId,etag,operation,{signal}={}){
  if(!researchId(workspaceId)||!etagValid(etag))invalid();signal?.throwIfAborted();
  const workspace=this.laboratory.workspace;if(await workspace.storageKind()!=='catalogue')return null;
  return this.laboratory.catalogue(async store=>{
   if((store.namespaceId??(await store.snapshot()).metadata.id)!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const owner=new SampleAnalysisCatalogue(store),source=await owner.source(etag);signal?.throwIfAborted();
   return source?operation(owner,source):null;
  },{signal});
 }
 async source(workspaceId,etag,{signal}={}){
  if(!researchId(workspaceId)||!etagValid(etag))invalid();signal?.throwIfAborted();
  if((await this.laboratory.workspace.outline()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const current=await this.laboratory.snapshot(etag);signal?.throwIfAborted();return current;
 }
 async query(command,{signal,collect}={}){
  if(!command||Object.keys(command).some(k=>!['workspaceId','view','search','sampleId','recordId','key','cursor','offset','limit'].includes(k)))invalid();
  const {workspaceId,view='samples',search='',sampleId=null,recordId=null,key=null,cursor=null,limit=25}=command;let offset=command.offset??0,etag=null;
  if(!views.includes(view)||typeof search!=='string'||search.length>512||![sampleId,recordId,key].every(id=>id===null||researchId(id))||!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>50000)invalid();
  const query=digest(serialize({workspaceId,view,search,sampleId,recordId,key,limit}));
  // This cursor is a position in an already-authorized private collection,
  // not an authorization token. Every request checks workspace and source.
  if(cursor!==null){
   if(typeof cursor!=='string'||cursor.length>1024||command.offset!==undefined)invalid();
   let value;try{value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{invalid();}
   if(!value||value.query!==query||!etagValid(value.etag)||value.etag===null||!Number.isSafeInteger(value.offset)||value.offset<0||value.offset>50000)invalid();
   ({offset,etag}=value);
  }
  const indexed=await this.indexed(workspaceId,etag,async(owner,source)=>({...await owner.query(source,{view,search,sampleId,recordId,key,offset,limit,signal,collect}),etag:source.etag}),{signal});
  if(indexed)return this.page({workspaceId,view,query,offset,limit,...indexed});
  const current=await this.source(workspaceId,etag,{signal}),lab=current.lab,samples=new Map(lab.samples.map(s=>[s.id,s])),counts={samples:lab.samples.length,analyses:0,review:0,archive:0,approved:0,events:lab.events.length},perSample=new Map();
  for(const a of lab.analyses){signal?.throwIfAborted();counts[a.status==='archived'?'archive':'analyses']++;if(a.status==='in review')counts.review++;if(a.status==='approved')counts.approved++;perSample.set(a.sampleId,(perSample.get(a.sampleId)??0)+1);}
  const rows=view==='samples'?lab.samples:view==='events'?lab.events:lab.analyses,items=[],needle=search.trim().toLocaleLowerCase('en');let total=0;
  for(const row of rows){
   signal?.throwIfAborted();if(key&&row.id!==key||recordId&&(view==='events'?row.recordId:row.id)!==recordId||sampleId&&(view==='samples'?row.id:row.sampleId)!==sampleId)continue;
   if(!['samples','events','all'].includes(view)&&(view==='archive'?row.status!=='archived':row.status==='archived')||view==='review'&&row.status!=='in review')continue;
   const sample=samples.get(row.sampleId),haystack=view==='samples'?[row.code,row.material,row.source]:view==='events'?[row.action,row.actor,row.reason]:[row.code,row.result.analyte,sample?.code];
   if(needle&&!haystack.join(' ').toLocaleLowerCase('en').includes(needle))continue;
   const position=total++;if(!collect&&(position<offset||items.length===limit))continue;
   const value=view==='samples'?{...row,analyses:perSample.get(row.id)??0}:view==='events'?{id:row.id,at:row.at,action:row.action,recordId:row.recordId,actor:row.actor,reason:row.reason}:{id:row.id,code:row.code,sampleId:row.sampleId,sampleCode:sample.code,status:row.status,updatedAt:row.updatedAt,result:{method:row.result.method,analyte:row.result.analyte,kind:row.result.kind,value:row.result.value,unit:row.result.unit,lower:row.result.lower,upper:row.result.upper}};
   if(collect)await collect(value);else items.push(value);
  }
  return this.page({workspaceId,view,query,offset,limit,items,counts,total,etag:current.etag});
 }
 page({workspaceId,view,query,offset,limit,items,counts,total,etag}){
  const at=Math.min(offset,Math.max(0,total)),encode=position=>Buffer.from(JSON.stringify({query,etag,offset:position})).toString('base64url');
  return {workspaceId,etag,view,items,counts,total,offset:at,cursor:encode(at),previousCursor:at?encode(Math.max(0,at-limit)):null,nextCursor:at+items.length<total?encode(at+items.length):null};
 }
 async selected(command,options){
  if(!command||Object.keys(command).some(k=>!['workspaceId','etag','id','kind'].includes(k))||!researchId(command.id)||!['sample','analysis'].includes(command.kind))invalid();
  const indexed=await this.indexed(command.workspaceId,command.etag??null,async(owner,source)=>({workspaceId:command.workspaceId,etag:source.etag,...await owner.selected(source,command.kind,command.id)}),options);
  if(indexed)return indexed;
  const current=await this.source(command.workspaceId,command.etag??null,options),record=current.lab[command.kind==='sample'?'samples':'analyses'].find(r=>r.id===command.id);
  if(!record)throw new AppError('NOT_FOUND');
  return {workspaceId:command.workspaceId,etag:current.etag,record,revision:digest(serialize(record)),...(command.kind==='analysis'?{sample:current.lab.samples.find(s=>s.id===record.sampleId)}:{})};
 }
}
