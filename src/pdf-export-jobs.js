// Durable exports belong to the independent PDF domain. Render callbacks run
// outside transactions; short, fenced writes retain each immutable output.
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {PdfDocumentStore} from './pdf-document-store.js';
import {RecordValueTree} from './record-value-tree.js';
import {RecordSequenceBuilder} from './record-tree-values.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {validPdfPreflight} from './pdf-preflight.js';
import {validPdfOutputProfile,validPdfOutputValidation} from './web/pdf-output-validation-model.js';

export const PDF_EXPORT_MAX_BYTES=64*1024*1024;
const JOB='pdf-export:job:',BLOCK='pdf-export:block:',DIRECTORY='pdf-export:directory';
const states=['queued','rendering','completed','failed','cancelled'];
const stages=['queued','preparing','compiling','assets','fonts','images','preflight','rendering','printing','retaining','completed','failed','cancelled'];
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const hash=value=>digest(serialize(value));
const bad=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const invalid=()=>{throw new AppError('INVALID');};
const abort=signal=>signal?.throwIfAborted();
const clock=async store=>{const now=Math.floor(Number((await store.db.get('SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now')).now));if(!natural(now))bad();return now;};
const validProgress=value=>exact(value,'stage,done,total')&&stages.includes(value.stage)&&natural(value.done)&&(value.total===null||natural(value.total)&&value.done<=value.total);
const validRenderer=value=>exact(value,'engine,electron,chromium,recipeVersion')&&value.engine==='chromium'&&['electron','chromium'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=80)&&Number.isSafeInteger(value.recipeVersion)&&value.recipeVersion>0;
const errorValue=error=>({code:error instanceof AppError?error.code:'IO',preflight:validPdfPreflight(error?.preflight)?structuredClone(error.preflight):null});
const attemptPrefix=job=>BLOCK+job.id+':'+job.attempt+':';
const identity=job=>({id:job.id,documentId:job.documentId,revision:job.revision,createdAt:job.createdAt});
const listKey=job=>String(9999999999999-job.createdAt).padStart(13,'0')+'-'+job.id;
function validateJob(value,id){
 if(!exact(value,'version,id,documentId,revision,state,attempt,createdAt,updatedAt,completedAt,lease,progress,error,output,cleanupPending')||![1,2].includes(value.version)||value.id!==id||!researchId(id)||!researchId(value.documentId)||!revisionId(value.revision)||!states.includes(value.state)||!natural(value.attempt)||!natural(value.createdAt)||value.createdAt>9999999999999||!natural(value.updatedAt)||value.updatedAt<value.createdAt||!validProgress(value.progress)||typeof value.cleanupPending!=='boolean')bad();
 if(value.lease!==null&&(!exact(value.lease,'token,until')||!researchId(value.lease.token)||!natural(value.lease.until)))bad();
 if((value.state==='rendering')!==(value.lease!==null)||value.state==='rendering'&&value.cleanupPending)bad();
 if(value.error!==null&&(!exact(value.error,'code,preflight')||typeof value.error.code!=='string'||new AppError(value.error.code).code!==value.error.code||value.error.preflight!==null&&!validPdfPreflight(value.error.preflight)))bad();
 if(value.state==='completed'){
  if(!exact(value.output,'root,bytes,sha256'+(value.version===2?',validation':''))||!revisionId(value.output.root)||!revisionId(value.output.sha256)||!natural(value.output.bytes)||value.output.bytes<5||value.output.bytes>PDF_EXPORT_MAX_BYTES||!natural(value.completedAt)||value.completedAt<value.createdAt||value.cleanupPending||value.error!==null||value.attempt<1)bad();
  if(value.version===2&&(!validPdfOutputValidation(value.output.validation)||value.output.validation.sha256!==value.output.sha256))bad();
 }else if(value.output!==null||value.completedAt!==null)bad();
 return value;
}
async function jobValue(store,id){if(!researchId(id))invalid();const value=await store.object(JOB+id);if(!value)throw new AppError('NOT_FOUND');return validateJob(value,id);}
async function summary(store,job,now,{details=true}={}){
 const selected=await pinnedDocument(store,job);if(job.version===2&&job.output)await outputValue(store,job,{selected});
 return {documentName:selected.header.name,...identity(job),state:job.state,attempt:job.attempt,updatedAt:job.updatedAt,completedAt:job.completedAt,progress:job.progress,error:details?job.error:job.error&&{code:job.error.code},recoverable:job.state!=='completed'&&(job.state!=='rendering'||job.lease.until<=now),...(job.output?{bytes:job.output.bytes,sha256:job.output.sha256,...(job.version===2?{validation:structuredClone(job.output.validation)}:{})}:{})};
}
class ExportBlocks{
 constructor(store,prefix,{signal,write=null}={}){this.store=store;this.prefix=prefix;this.signal=signal;this.write=write;this.pending=new Map();}
 key(kind,revision){if(!['value','index'].includes(kind)||!revisionId(revision))bad();return this.prefix+kind+':'+revision;}
 async put(kind,value){abort(this.signal);const text=serialize(value);if(Buffer.byteLength(text)>65536)throw new AppError('PDF_CAPACITY');const revision=digest(text),key=this.key(kind,revision);if(this.write){this.pending.set(key,value);if(this.pending.size>=16)await this.flush();}else await this.store.putObject(key,value);return revision;}
 async flush(){if(!this.pending.size)return;const rows=[...this.pending];await this.write(async store=>{for(const [key,value] of rows){abort(this.signal);await store.putObject(key,value);}});this.pending.clear();}
 async read(kind,revision){abort(this.signal);const key=this.key(kind,revision),value=this.pending.get(key)??await this.store.object(key);if(!value||Buffer.byteLength(serialize(value))>65536||hash(value)!==revision)bad();return value;}
}
const directoryIndex=store=>new RetainedTableIndex(new ExportBlocks(store,BLOCK+'directory:'),{namespace:'index',allowSparseBranches:true});
async function directory(store){const value=await store.object(DIRECTORY);if(value){if(!exact(value,'version,root')||value.version!==1||!validTableRef(value.root))bad();return value;}for await(const id of store.objectIdEntries(JOB)){void id;bad();}return {version:1,root:null};}
async function pinnedDocument(store,job){const documents=new PdfDocumentStore(store),head=await documents.head(job.documentId,{removed:true});if(!await documents.index(job.documentId).find({root:head.versions},job.revision))bad();const value=await documents.revision(job.documentId,job.revision);if((job.version===2)!==validPdfOutputProfile(value.header.outputProfile)||job.version===2&&job.output&&job.output.validation.profile!==value.header.outputProfile)bad();return value;}
// Reuse the canonical string tree without allocating a second whole-PDF
// base64 string. Each node contains at most 32 KiB of canonical JSON bytes.
async function retainBytes(blocks,bytes,signal){
 const sequence=new RecordSequenceBuilder(blocks);let tail=Buffer.alloc(0),length=0;
 const add=async chunk=>{abort(signal);length+=chunk.length;let data=tail.length?Buffer.concat([tail,chunk]):chunk;while(data.length>=32768){await sequence.addNode({type:'bytes',value:data.subarray(0,32768).toString('base64')});data=data.subarray(32768);}tail=Buffer.from(data);};
 await add(Buffer.from('"'));for(let offset=0;offset<bytes.length;offset+=24576)await add(Buffer.from(bytes.subarray(offset,offset+24576).toString('base64')));await add(Buffer.from('"\n'));
 if(tail.length)await sequence.addNode({type:'bytes',value:tail.toString('base64')});
 return blocks.put('value',{type:'string',root:await sequence.finishIndex(),bytes:length});
}
async function outputValue(store,job,{signal,selected=null}={}){
 selected??=await pinnedDocument(store,job);
 const blocks=new ExportBlocks(store,attemptPrefix(job),{signal}),tree=new RecordValueTree(blocks);let text='';
 for await(const chunk of tree.json(job.output.root,{signal})){abort(signal);text+=chunk;if(Buffer.byteLength(text)>512*1024)bad();}
 let value;try{value=JSON.parse(text);}catch{bad();}
 if(!exact(value,'version,documentId,revision,root,bytes,sha256,renderer,preflight'+(job.version===2?',validation':''))||value.version!==job.version||value.documentId!==job.documentId||value.revision!==job.revision||value.bytes!==job.output.bytes||value.sha256!==job.output.sha256||!revisionId(value.root)||!validRenderer(value.renderer)||!validPdfPreflight(value.preflight)||value.preflight.status==='fatal')bad();
 if(job.version===2&&(!validPdfOutputValidation(value.validation)||value.validation.profile!==selected.header.outputProfile||value.validation.sha256!==value.sha256||Object.keys(value.validation).some(key=>value.validation[key]!==job.output.validation[key])))bad();
 const node=await tree.node(value.root);if(node.type!=='string'||node.bytes!==Math.ceil(value.bytes/3)*4+3)bad();return {value,tree};
}
async function readOutput(store,job,{signal,collect=false}={}){
 const {value,tree}=await outputValue(store,job,{signal}),digestValue=createHash('sha256'),chunks=[];let carry='',size=0,encoded=0,ended=false,signature=Buffer.alloc(0);
 const consume=part=>{if(!part)return;if(ended||!/^[A-Za-z0-9+/]*={0,2}$/.test(part))bad();const bytes=Buffer.from(part,'base64');if(bytes.toString('base64')!==part)bad();ended=part.includes('=');size+=bytes.length;if(size>value.bytes)bad();if(signature.length<5)signature=Buffer.concat([signature,bytes.subarray(0,5-signature.length)]);digestValue.update(bytes);if(collect)chunks.push(bytes);};
 for await(const text of tree.text(value.root,[],{signal})){abort(signal);encoded+=text.length;if(encoded>Math.ceil(value.bytes/3)*4)bad();carry+=text;const end=carry.length-carry.length%4;if(end){consume(carry.slice(0,end));carry=carry.slice(end);}}
 if(carry||size!==value.bytes||encoded!==Math.ceil(value.bytes/3)*4||signature.toString()!=='%PDF-'||digestValue.digest('hex')!==value.sha256)bad();
 return {...value,...(collect?{bytes:Buffer.concat(chunks,size)}:{})};
}

export class PdfExportJobs{
 constructor(documents,{prepare=null,leaseMs=30000}={}){if(!documents?.domains||prepare!==null&&typeof prepare!=='function'||!Number.isInteger(leaseMs)||leaseMs<100||leaseMs>300000)invalid();this.documents=documents;this.prepare=prepare;this.leaseMs=leaseMs;this.active=new Map();}
 run(write,operation,options={}){return this.documents.domains.run(['pdf'],get=>operation(get('pdf')),{signal:options.signal,check:options.check,...(write?{write:['pdf']}:{})});}
 async start(data,options={}){
  if(!exact(data,'jobId,documentId,revision')||!researchId(data.jobId)||!researchId(data.documentId)||!revisionId(data.revision))invalid();abort(options.signal);await options.check?.();if(!await this.documents.available())throw new AppError('NOT_FOUND');
  return this.run(true,async store=>{
   const previous=await store.object(JOB+data.jobId);if(previous){const job=validateJob(previous,data.jobId);if(job.documentId!==data.documentId||job.revision!==data.revision)throw new AppError('MODULE_REPLAY');return summary(store,job,await clock(store));}
   const selected=await new PdfDocumentStore(store).open(data.documentId,{revision:data.revision});const now=await clock(store),job={version:validPdfOutputProfile(selected.header.outputProfile)?2:1,id:data.jobId,documentId:data.documentId,revision:data.revision,state:'queued',attempt:0,createdAt:now,updatedAt:now,completedAt:null,lease:null,progress:{stage:'queued',done:0,total:null},error:null,output:null,cleanupPending:false};
   const head=await directory(store),index=directoryIndex(store);head.root=await index.change(head.root,listKey(job),hash(identity(job)));await index.flush(head.root);await store.putObject(DIRECTORY,head);await store.putObject(JOB+job.id,job);return summary(store,job,now);
  },options);
 }
 async status(id,options={}){return this.run(false,async store=>summary(store,await jobValue(store,id),await clock(store)),options);}
 async list({after=null,limit=20}={},options={}){
  if(after!==null&&!researchId(after)||!Number.isInteger(limit)||limit<1||limit>20)invalid();if(!await this.documents.available()){await options.check?.();return {items:[],next:null};}
  return this.run(false,async store=>{const head=await directory(store),index=directoryIndex(store),items=[],now=await clock(store);let offset=0;
   if(after!==null){const prior=await jobValue(store,after),key=listKey(prior);if((await index.find(head,key))?.revision!==hash(identity(prior)))bad();offset=await index.rank(head,key)+1;}
   while(offset<(head.root?.count??0)&&items.length<limit){const row=await index.entryAt(head,offset++),id=row.id.slice(14),job=await jobValue(store,id);if(row.id!==listKey(job)||row.revision!==hash(identity(job)))bad();items.push(await summary(store,job,now,{details:false}));}
   return {items,next:offset<(head.root?.count??0)?items.at(-1).id:null};
  },options);
 }
 async clean(id,attempt,options={}){
  for(;;){const complete=await this.run(true,async store=>{const job=await jobValue(store,id);if(job.attempt!==attempt||!job.cleanupPending)return true;if(job.state==='rendering'||job.state==='completed')bad();const keys=[];
   for await(const key of store.objectIdEntries(attemptPrefix(job),{signal:options.signal})){keys.push(key);if(keys.length===16)break;}
   for(const key of keys){abort(options.signal);await store.deleteObject(key);}
   if(keys.length===16)return false;job.cleanupPending=false;await store.putObject(JOB+id,job);return true;
  },options);if(complete)return;}
 }
 async cancel(id,options={}){
  const job=await this.run(true,async store=>{const job=await jobValue(store,id);if(job.state==='completed')throw new AppError('JOB_CHANGED');job.state='cancelled';job.lease=null;job.progress={stage:'cancelled',done:0,total:null};job.error=null;job.cleanupPending=job.attempt>0;job.updatedAt=await clock(store);await store.putObject(JOB+id,job);return job;},options);
  this.active.get(id)?.abort(new AppError('PDF_CANCELLED'));await this.clean(id,job.attempt,options);return this.status(id,options);
 }
 async resume(id,options={}){
  const job=await this.run(true,async store=>{const job=await jobValue(store,id),now=await clock(store);if(job.state==='completed')return job;if(job.state==='rendering'&&job.lease.until>now)throw new AppError('PDF_BUSY');
   job.state='queued';job.lease=null;job.error=null;job.cleanupPending=job.attempt>0;job.updatedAt=now;job.progress={stage:'queued',done:0,total:null};await store.putObject(JOB+id,job);return job;
  },options);if(job.state!=='completed')await this.clean(id,job.attempt,options);return this.status(id,options);
 }
 async fenced(id,token,operation,options={}){return this.run(true,async store=>{const job=await jobValue(store,id),now=await clock(store);if(job.state!=='rendering'||job.lease.token!==token||job.lease.until<=now)throw new AppError('JOB_LEASE');return operation(store,job,now);},options);}
 async work(id,options={}){
  if(!this.prepare)throw new AppError('PDF_DESKTOP');
  let outputProfile;
  const claim=await this.run(true,async store=>{const job=await jobValue(store,id),now=await clock(store);if(job.state!=='queued'||job.cleanupPending)throw new AppError(job.state==='rendering'?'PDF_BUSY':'JOB_CHANGED');outputProfile=(await pinnedDocument(store,job)).header.outputProfile;
   job.state='rendering';job.attempt++;job.updatedAt=now;job.lease={token:randomUUID(),until:now+this.leaseMs};job.progress={stage:'preparing',done:0,total:null};await store.putObject(JOB+id,job);return job;
  },options),token=claim.lease.token,controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal,scoped={signal,check:options.check};
  this.active.set(id,controller);let pulse=Promise.resolve();
  const heartbeat=()=>{pulse=pulse.then(()=>this.fenced(id,token,async(store,job,now)=>{job.lease.until=now+this.leaseMs;job.updatedAt=now;await store.putObject(JOB+id,job);},scoped)).catch(error=>{controller.abort(error);});};
  const timer=setInterval(heartbeat,Math.max(25,Math.floor(this.leaseMs/3)));timer.unref?.();
  const progress=async(value,counts={})=>{const next=typeof value==='string'?{stage:value,done:counts.done??0,total:counts.total??null}:{stage:value?.stage,done:value?.done??0,total:value?.total??null};if(!validProgress(next)||['queued','completed','failed','cancelled'].includes(next.stage))invalid();return this.fenced(id,token,async(store,job,now)=>{job.progress=next;job.updatedAt=now;job.lease.until=now+this.leaseMs;await store.putObject(JOB+id,job);},scoped);};
  try{
   await options.check?.();abort(signal);const result=await this.prepare({documentId:claim.documentId,revision:claim.revision},{signal,progress,check:options.check??(async()=>{})});abort(signal);await options.check?.();
   if(validPdfPreflight(result?.preflight)&&result.preflight.status==='fatal'){const error=new AppError('PDF_PREFLIGHT');error.preflight=result.preflight;throw error;}
   if(!Buffer.isBuffer(result?.bytes)||result.bytes.length<5||result.bytes.length>PDF_EXPORT_MAX_BYTES||result.bytes.subarray(0,5).toString()!=='%PDF-'||!validRenderer(result.renderer)||!validPdfPreflight(result.preflight))throw new AppError('PDF_OUTPUT');
   const bytes=Buffer.from(result.bytes),sha256=digest(bytes),renderer=structuredClone(result.renderer),preflight=structuredClone(result.preflight);if(result.sha256!==sha256)throw new AppError('PDF_OUTPUT');
   if(claim.version===2?(!validPdfOutputValidation(result.validation)||result.validation.profile!==outputProfile||result.validation.sha256!==sha256):Object.hasOwn(result,'validation'))throw new AppError('PDF_OUTPUT');
   const validation=claim.version===2?structuredClone(result.validation):null;
   await progress('retaining',{done:0,total:bytes.length});
   const blocks=new ExportBlocks(null,attemptPrefix(claim),{signal,write:operation=>this.fenced(id,token,store=>operation(store),scoped)}),root=await retainBytes(blocks,bytes,signal),value={version:claim.version,documentId:claim.documentId,revision:claim.revision,root,bytes:bytes.length,sha256,renderer,preflight,...(validation?{validation}:{})},outputRoot=await new RecordValueTree(blocks).retain(value);await blocks.flush();abort(signal);
   await this.fenced(id,token,async(store,job,now)=>{job.state='completed';job.completedAt=now;job.updatedAt=now;job.lease=null;job.output={root:outputRoot,bytes:bytes.length,sha256,...(validation?{validation}:{})};job.progress={stage:'completed',done:bytes.length,total:bytes.length};await store.putObject(JOB+id,job);},scoped);
  }catch(error){
   // Revoked authorization cannot mutate the owner. In that case the durable
   // lease expires and an authenticated explicit resume owns cleanup/retry.
   const failed=await this.run(true,async store=>{const job=await jobValue(store,id);if(job.state!=='rendering'||job.lease.token!==token)return false;job.state='failed';job.lease=null;job.updatedAt=await clock(store);job.error=errorValue(error);job.cleanupPending=true;job.progress={stage:'failed',done:0,total:null};await store.putObject(JOB+id,job);return true;},{check:options.check});
   if(failed)await this.clean(id,claim.attempt,{check:options.check});
  }finally{clearInterval(timer);await pulse.catch(()=>{});if(this.active.get(id)===controller)this.active.delete(id);}
  return this.status(id,{check:options.check});
 }
 async download(id,options={}){
  return this.run(false,async store=>{const job=await jobValue(store,id);if(job.state!=='completed')throw new AppError('JOB_CHANGED');const result=await readOutput(store,job,{signal:options.signal,collect:true});abort(options.signal);await options.check?.();return {bytes:result.bytes,sha256:result.sha256,renderer:result.renderer,preflight:result.preflight,...(job.version===2?{validation:result.validation}:{}),documentId:job.documentId,revision:job.revision,completedAt:job.completedAt};},options);
 }
}

export async function verifyPdfExportJobs(store,{signal}={}){
 if(store.domain!=='pdf')invalid();const head=await directory(store),index=directoryIndex(store);let count=0,completed=0;
 for await(const key of store.objectIdEntries(JOB,{signal})){abort(signal);const job=await jobValue(store,key.slice(JOB.length));if((await index.find(head,listKey(job)))?.revision!==hash(identity(job)))bad();await pinnedDocument(store,job);count++;if(job.state==='completed'){await readOutput(store,job,{signal});completed++;}}
 if(count!==(head.root?.count??0))bad();for await(const row of index.entries(head)){abort(signal);const job=await jobValue(store,row.id.slice(14));if(listKey(job)!==row.id||hash(identity(job))!==row.revision)bad();}
 for await(const key of store.objectIdEntries(BLOCK,{signal})){
  abort(signal);const suffix=key.slice(BLOCK.length),match=/^(directory|([a-f0-9-]{36}):([1-9][0-9]*)):(value|index):([a-f0-9]{64})$/.exec(suffix);if(!match)bad();
  const value=await store.object(key);if(!value||Buffer.byteLength(serialize(value))>65536||hash(value)!==match[5])bad();
  if(match[1]!=='directory'){const job=await jobValue(store,match[2]);if(job.attempt!==Number(match[3])||!['completed','rendering'].includes(job.state)&&!job.cleanupPending)bad();}
 }
 return {jobs:count,completed};
}
