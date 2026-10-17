import {openPublicationInput} from './publication-input-reader.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {ResearchMaterials} from './research-materials.js';
import {PublicationJobs} from './publication-jobs.js';
import {WebsiteDocumentStore} from './website-document-store.js';
import {websiteWorkspace} from './website-workspace.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';

// Receipts describe a saved record and its then-current evidence, not just its
// narrative. Stream indexed heads; never load raw files to determine freshness.
export const receiptKinds=['validation','publication','git'];
export function evidenceDigest(){
 const hash=createHash('sha256');hash.update('observanda-run-evidence-v1\n');
 return {add:item=>hash.update(JSON.stringify([item.kind,item.id,item.revision])+'\n'),finish:()=>hash.digest('hex')};
}
export async function runEvidenceRevision(workspace,recordId,{signal}={}){
 const materials=new ResearchMaterials(workspace),digest=evidenceDigest();let cursor=null;
 do{signal?.throwIfAborted();const page=await materials.list({recordId,cursor,limit:20,signal});for(const item of page.items)digest.add(item);cursor=page.next;}while(cursor);
 return digest.finish();
}
export const applicableReceipt=(receipt,revisions,evidenceRevision)=>revisions.includes(receipt.recordRevision)&&receipt.evidenceRevision===evidenceRevision;
const nonempty=(v,max)=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export function declaredReceipt(command){
 if(!nonempty(command.statement,2000)||!revisionId(command.sourceSha256)||command.sourceRevision!==undefined&&!nonempty(command.sourceRevision,500))throw new AppError('INTAKE_INVALID');
 const receipt={statement:command.statement,sourceSha256:command.sourceSha256,declared:true,
  ...(command.sourceRevision?{source:{revision:command.sourceRevision,sha256:command.sourceSha256}}:{})};
 if(command.kind==='git'){
  if(typeof command.commit!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(command.commit)||!nonempty(command.repository,500))throw new AppError('INTAKE_INVALID');
  receipt.git={repository:command.repository,commit:command.commit};
 }else{
  if(!nonempty(command.tool,200)||!nonempty(command.toolVersion,200)||!revisionId(command.toolSha256))throw new AppError('INTAKE_INVALID');
  receipt.tool={name:command.tool,version:command.toolVersion,sha256:command.toolSha256};
 }
 return receipt;
}
export async function receiptWebsite(workspace,websiteId=null){
 if(websiteId!==null&&!researchId(websiteId))throw new AppError('INTAKE_INVALID');
 const scoped=websiteWorkspace(workspace,websiteId);let name=null;
 if(await workspace.storageKind()==='catalogue'){
  try{name=(await workspace.catalogue(store=>new WebsiteDocumentStore(store).head(websiteId,{includeRemoved:true}))).name;}
  catch(error){if(error.code!=='NOT_FOUND')throw error;}
 }else name=(await scoped.website()).name;
 return {workspace:scoped,websiteId,name};
}
export async function publicationReceipt(workspace,{websiteId=null,publicationJob},recordId,revision){
 if(!researchId(publicationJob))throw new AppError('INTAKE_INVALID');
 const scoped=await receiptWebsite(workspace,websiteId),source=await new PublicationJobs(scoped.workspace).source(publicationJob);
 const raw=await scoped.workspace.readMetadata('.observanda/release-candidates/'+source.reviewId+'.json',16*1024*1024);
 const input=await openPublicationInput(scoped.workspace,source),record=await input.recordTarget({workspaceId:source.workspaceId,kind:'record',id:recordId,revision});
 if(!raw||!record)throw new AppError('INTAKE_RECEIPT');
 const candidate=JSON.parse(raw),metadata=await input.metadata();
 if(candidate.jobId!==source.id||candidate.reviewId!==source.reviewId||!revisionId(candidate.id)||(candidate.websiteId??null)!==websiteId||(source.websiteId??null)!==websiteId)throw new AppError('INTAKE_RECEIPT');
 return {jobId:source.id,reviewId:source.reviewId,releaseId:candidate.id,websiteId,websiteName:scoped.name??metadata.website?.title??metadata.title,createdAt:candidate.createdAt};
}
export async function receiptEditions(workspace,{websiteId=null,cursor=null},recordId,revision,{signal}={}){
 const scoped=await receiptWebsite(workspace,websiteId),releases=new PublicationJobs(scoped.workspace),page=await releases.feed.page({cursor,limit:20}),items=[];
 for(const item of page.items){
  signal?.throwIfAborted();const source=await releases.source(item.id),input=await openPublicationInput(scoped.workspace,source,{signal}),exact=await input.recordTarget({workspaceId:source.workspaceId,kind:'record',id:recordId,revision});
  let selected=exact;
  if(!selected){if(source.version===6)selected=(await input.window('records',{index:'original',prefix:source.workspaceId+'/'+recordId+'/',limit:1})).items[0];else selected=(source.records??[]).find(row=>(row.recordId??row.id)===recordId);}
  if(!selected)continue;
  try{const ref=await publicationReceipt(workspace,{websiteId,publicationJob:item.id},recordId,selected.revision);items.push({...ref,current:!!exact});}
  catch(error){if(error.code!=='INTAKE_RECEIPT')throw error;}
 }
 return {items,next:page.next};
}

// Only labels and owner IDs cross this continuation boundary. Selecting an
// edition resolves its own immutable source separately.
export async function receiptWebsites(workspace,{after=null,limit=20,signal}={}){
 if(after!==null&&after!=='default'&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new AppError('INTAKE_INVALID');
 if(await workspace.storageKind()==='catalogue')return workspace.catalogue(async store=>{
  const page=await new WebsiteDocumentStore(store).list({after,limit,includeDefault:after===null});signal?.throwIfAborted();
  return {items:page.sites.map(({websiteId,name})=>({id:websiteId,name})),next:page.next};
 });
 const {metadata}=await workspace.outline(),sites=[{id:null,name:metadata.website.title||metadata.title},...(metadata.websites??[])].filter(site=>after===null||site.id!==null&&(after==='default'||site.id>after)).sort((a,b)=>a.id===null?-1:b.id===null?1:a.id<b.id?-1:1),items=sites.slice(0,limit).map(({id,name})=>({id,name}));
 return {items,next:sites.length>limit?(items.at(-1).id??'default'):null};
}
