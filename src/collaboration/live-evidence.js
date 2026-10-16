import {materialRef,EVIDENCE_CHUNK} from '../research-materials.js';
import {LiveMaterialReading} from './live-material-reading.js';
import {liveRecord} from './live-access.js';
import {DurableJobs,jobSummary} from '../jobs.js';
import {researchJobDefinitions} from '../research-jobs.js';
import {MetadataFeed} from '../metadata-feed.js';
import {digest} from '../storage-format.js';
import {identityHash} from './identity.js';
import {liveValid as valid} from './live-protocol.js';
import {uuid,exact} from '../modules/validation.js';
import {validEvidenceFile,evidencePurposes} from '../web/evidence-files.js';

const prefix='.observanda/collaboration/live/evidence/';
export class LiveEvidence extends LiveMaterialReading{
 constructor(workspace){super(workspace,liveRecord);this.queue=new DurableJobs(workspace,researchJobDefinitions(workspace,()=>this.queue));}
 async read(store,access,source,ref,trail=[]){
  valid(materialRef(ref)&&ref.kind!=='record');const head=await this.materials.current(ref.id);
  valid(head?.recordId===source.id&&head.kind===ref.kind,'COLLABORATION_DENIED');
  const original=await this.materials.read(ref);valid(original.recordId===source.id,'COLLABORATION_DENIED');
  return super.read(store,access,source,ref,trail);
 }
 feed(access,scope,recordId){return new MetadataFeed(this.workspace,prefix+access.principalId+'/'+scope.grantId+'/'+recordId);}
 async summary(session){return {...await this.materials.uploads.summary(session),fingerprint:session.fingerprint,sourcePath:session.sourcePath,sourcePurpose:session.sourcePurpose,provenance:session.provenance,job:jobSummary(await this.queue.read(session.id))};}
 async owned(access,scope,recordId,id){
  valid(uuid(id));const session=await this.materials.importState(id);
  valid(session.recordId===recordId&&session.live?.principalId===access.principalId&&identityHash(session.live.scope)===identityHash(scope),'COLLABORATION_DENIED');return session;
 }
 // The caller has already checked the current grant and record in this transaction.
 async dispatch(store,identity,access,scope,record,operation,data){
  const m=this.materials;
  if(operation==='evidence-read')return this.read(store,access,record,data.ref,data.trail);
  if(operation==='evidence-page')return this.page(store,access,record,data);
  if(operation==='evidence-uploads'){
   const feed=this.feed(access,scope,record.id);await feed.ensureLocked();const page=await feed.page({cursor:data.cursor??null}),items=[];
   for(const item of page.items)items.push(await this.summary(await this.owned(access,scope,record.id,item.id)));
   return {items,next:page.next};
  }
  if(operation==='evidence-start'){
   valid(exact(data,['recordId','id','file','purpose','provenance'])&&uuid(data.id)&&validEvidenceFile(data.file)&&exact(data.file,['name','size','fingerprint',...(Object.hasOwn(data.file,'sourcePath')?['sourcePath']:[])])&&evidencePurposes.includes(data.purpose)&&typeof data.provenance==='string'&&data.provenance.length<=10000);
   const receipt=prefix+access.principalId+'/requests/'+data.id+'.json',hash=identityHash({scope,data}),raw=await this.workspace.readMetadata(receipt,1024);
   if(raw){const prior=JSON.parse(raw);valid(prior.hash===hash,'CONFLICT');return this.summary(await this.owned(access,scope,record.id,prior.id));}
   const feed=this.feed(access,scope,record.id);await feed.ensureLocked();
   const session=await m.startImportLocked({recordId:record.id,name:data.file.name,size:data.file.size,provenance:data.provenance},{fingerprint:data.file.fingerprint,...(data.file.sourcePath?{sourcePath:data.file.sourcePath}:{}),sourcePurpose:data.purpose});
   session.live={identity,scope,principalId:access.principalId,pendingFile:feed.order+'/'+feed.key(session)};
   await m.put(m.metadataFile('imports/'+session.id+'/session.json'),session);await feed.putLocked(session);
   await this.workspace.writeMetadata(receipt,JSON.stringify({hash,id:session.id}));return this.summary(session);
  }
  const session=await this.owned(access,scope,record.id,data.id);
  if(operation==='evidence-upload')return this.summary(session);
  if(operation==='evidence-chunk'){
   valid(Number.isSafeInteger(data.index)&&data.index>=0&&typeof data.bytes==='string'&&data.bytes.length<=Math.ceil(EVIDENCE_CHUNK/3)*4);
   const bytes=Buffer.from(data.bytes,'base64');valid(bytes.length>0&&bytes.toString('base64')===data.bytes);
   const count=m.uploads.count(session);
   if(data.index<count){
    const receipt=await m.sequences.item(session.chunksIndex,data.index);valid(receipt.size===bytes.length&&receipt.sha256===digest(bytes),'MATERIAL_SOURCE_CHANGED');return this.summary(session);
   }
   valid(!await this.queue.read(session.id),'MATERIAL_CHANGED');
   return this.summary(await m.appendImportLocked(session.id,data.index,[bytes]));
  }
  valid(operation==='evidence-finish');valid(m.uploads.bytes(session)===session.size,'MATERIAL_INCOMPLETE');
  if(!session.completed){
   // Zero-byte originals have no last chunk on which to check their fingerprint.
   if(!session.size)valid(session.fingerprint===digest('Observanda/evidence-file/v1:0:0:'+'0'.repeat(64)),'MATERIAL_SOURCE_CHANGED');
   const job=await this.queue.enqueueLocked({id:session.id,type:'evidence.finalize',scope:record.id,input:{importId:session.id,size:session.size}});
   if(['failed','cancelled'].includes(job.state))await this.queue.controlLocked(job.id,'retry');
  }
  return this.summary(session);
 }
}
