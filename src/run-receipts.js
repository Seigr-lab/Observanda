import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {ResearchMaterials} from './research-materials.js';
import {websitePublicationMetadata} from './website-publication-metadata.js';
import {readReleaseLedger,readReleaseRecords} from './website-release-ledger.js';
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
// Publication receipts cite a website made in the website editor and one of
// its published versions that showed this exact record revision. Only labels,
// identities and dates cross this boundary; no website files are read.
function websiteFiles(files){if(!files||typeof files.list!=='function')throw new AppError('INTAKE_RECEIPT');return files;}
async function releaseRows(files,websiteId){
 if(websiteId!==null&&!researchId(websiteId))throw new AppError('INTAKE_INVALID');
 const metadata=websitePublicationMetadata(await files.publicationWorkspace(websiteId));
 return {metadata,rows:(await readReleaseLedger(metadata)).filter(row=>row.edition==='website')};
}
async function releaseRecord(metadata,row,{workspaceId,recordId}){
 const records=await readReleaseRecords(metadata,row.releaseId);
 return records?.find(item=>item.workspaceId===workspaceId&&item.recordId===recordId)??null;
}
async function websiteName(files,websiteId){
 for(let after=null;;){
  const page=await files.list({limit:100,after});const site=page.items.find(item=>(item.id??null)===websiteId);if(site)return site.name;
  if(!page.next)return null;after=page.next;
 }
}
export async function publicationReceipt(files,{websiteId=null,releaseId},owner){
 if(!revisionId(releaseId))throw new AppError('INTAKE_INVALID');
 files=websiteFiles(files);const {metadata,rows}=await releaseRows(files,websiteId),row=rows.find(item=>item.releaseId===releaseId);
 const record=row?await releaseRecord(metadata,row,owner):null;
 if(!record||record.recordRevision!==owner.revision)throw new AppError('INTAKE_RECEIPT');
 return {websiteId,websiteName:await websiteName(files,websiteId),releaseId,siteRevision:row.revision,publishedAt:row.completedAt};
}
const EDITION_PAGE=20;
export async function receiptEditions(files,{websiteId=null,cursor=null},owner,{signal}={}){
 const offset=cursor===null?0:Number(cursor);if(!Number.isSafeInteger(offset)||offset<0)throw new AppError('INTAKE_INVALID');
 const {metadata,rows}=await releaseRows(websiteFiles(files),websiteId),items=[];
 for(const row of rows.slice(offset,offset+EDITION_PAGE)){
  signal?.throwIfAborted();const record=await releaseRecord(metadata,row,owner);
  if(record)items.push({releaseId:row.releaseId,publishedAt:row.completedAt,current:record.recordRevision===owner.revision});
 }
 return {items,next:offset+EDITION_PAGE<rows.length?String(offset+EDITION_PAGE):null};
}
export async function receiptWebsites(files,{after=null,limit=20,signal}={}){
 if(after!==null&&(typeof after!=='string'||after.length>100)||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new AppError('INTAKE_INVALID');
 const page=await websiteFiles(files).list({limit,after,signal});
 return {items:page.items.map(site=>({id:site.id??null,name:site.name})),next:page.next};
}
