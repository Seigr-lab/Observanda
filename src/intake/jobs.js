import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import {AppError} from '../errors.js';
import {writeContent} from '../file-content.js';
import {assertRegular} from '../storage.js';
import {sourceChunks} from '../migration/source-files.js';
import {withWorkspaceMetadataBatch} from '../metadata-batch.js';
import {LocalIntake} from './service.js';
import {inspectIntake} from './source.js';
import {inspectPreparedIntake} from './prepared.js';
import {LocalIntakeFinalization} from './finalization.js';
export function intakeJobDefinitions(workspace,queue){
 const intake=()=>new LocalIntake(workspace,queue());
 const authorize=async job=>{
  const p=await intake().read(job.input.id);
  if(job.scope!==p.manifest.recordId||job.id!==(job.type==='intake.stage'?p.stageJob:p.applyJob))throw new AppError('JOB_CHANGED');
  await intake().bind(p.manifest,{checkRevision:false});
 };
 return {'intake.stage':{authorize,prepare:async(job,{signal,progress,write})=>{
  const service=intake(),p=await service.read(job.input.id);
  write??=operation=>queue().checkpoint(job.id,job.lease.token,async()=>{signal?.throwIfAborted();const result=await operation();signal?.throwIfAborted();return result;});
  const checkpoint=verification=>write(async()=>{
   const current=await service.read(p.id);
   if(current.pin!==verification.pin||current.state!=='staging')throw new AppError('INTAKE_CHANGED');
   const prior=current.sourceVerification,declared=new Set(current.manifest.files.map(file=>file.id)),files=new Map((prior?.pin===verification.pin&&prior.manifestStamp===verification.manifestStamp&&Array.isArray(prior.files)&&prior.files.length<=current.manifest.files.length?prior.files:[]).filter(file=>file&&declared.has(file.id)).map(file=>[file.id,file]));
   for(const file of verification.files)files.set(file.id,file);
   current.sourceVerification={...verification,files:[...files.values()]};await service.write(current);
  });
  const report=await inspectIntake(p.source,{signal,expectedPin:p.pin,progress,verification:p.sourceVerification,checkpoint});await service.validateTargets(p.manifest,{signal});
  let done=0;const total=job.input.size;
  for(const f of report.files){
   signal.throwIfAborted();const previous=p.prepared.find(v=>v.id===f.id);
   if(previous){const content=await service.preparedContent(p,previous);if(content.sha256!==f.sha256||content.size!==f.size)throw new AppError('MATERIAL_MISSING');await content.verify({signal});done+=f.size;continue;}
   const storageId=randomUUID(),file=path.join(await service.materials.directory('originals/'+f.id),storageId+'.original');let retained=false;
   async function* chunks(){for await(const bytes of sourceChunks(report.root,f.path,f,{signal})){done+=bytes.length;await progress({stage:'staging',done,total,unit:'bytes'});yield bytes;}}
   try{
    const result=await writeContent(workspace,file,chunks(),{maxBytes:f.size||1,signal,expected:{size:f.size,sha256:f.sha256}});
    if(result.sha256!==f.sha256||result.size!==f.size)throw new AppError('INTAKE_CHANGED');
    const prepared={id:f.id,storageId,sha256:f.sha256,size:f.size};
    await write(async()=>{const current=await service.read(p.id);if(current.prepared.some(v=>v.id===f.id))throw new AppError('JOB_CHANGED');current.prepared.push(prepared);await service.write(current);});
    p.prepared.push(prepared);retained=true;
   }finally{if(!retained&&await assertRegular(file,{missing:true}))await unlink(file);}
  }
  return {pin:p.pin};
 },commit:async(job,result)=>{
  const service=intake(),p=await service.read(job.input.id);if(p.pin!==result.pin||p.prepared.length!==p.manifest.files.length)throw new AppError('INTAKE_CHANGED');
  p.state='prepared';await service.write(p);return {id:p.id,pin:p.pin};
 }},'intake.apply':{authorize,prepare:async(job,{signal,progress,write})=>{
  const service=intake(),p=await service.read(job.input.id);await service.validateTargets(p.manifest,{signal});
  const report=await inspectPreparedIntake(service,p,{signal,progress});return new LocalIntakeFinalization(service).stage(job,report,{signal,progress,write});
 },beforeComplete:(job,report,options)=>new LocalIntakeFinalization(intake()).beforeComplete(job,report,options),
 commit:(job,proof)=>withWorkspaceMetadataBatch(workspace,()=>new LocalIntakeFinalization(intake()).commit(job,proof))}};
}
