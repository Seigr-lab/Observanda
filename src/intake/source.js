import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from '../errors.js';
import {checkedSourcePath,sourceChunks,sourceStamp} from '../migration/source-files.js';
import {INTAKE_MANIFEST,INTAKE_LIMIT,validateIntake,intakeHash} from './contract.js';
const checkpointBytes=8*1024*1024;
export async function intakeSourceFile(root,name){
 const s=await lstat(await checkedSourcePath(root,name),{bigint:true});
 if(!s.isFile()||s.size>BigInt(Number.MAX_SAFE_INTEGER))throw new AppError('INTAKE_INVALID');
 return {size:Number(s.size),stamp:sourceStamp(s)};
}
export async function inspectIntake(source,{signal,expectedPin,progress=async()=>{},verification,checkpoint=async()=>{}}={}){
 if(typeof source!=='string'||!path.isAbsolute(source))throw new AppError('INTAKE_INVALID');
 const root=path.resolve(source),known=await intakeSourceFile(root,INTAKE_MANIFEST);
 if(known.size>INTAKE_LIMIT)throw new AppError('LIMIT');
 const chunks=[];for await(const b of sourceChunks(root,INTAKE_MANIFEST,known,{signal}))chunks.push(b);
 let manifest;try{manifest=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('INTAKE_INVALID');}
 validateIntake(manifest);const pin=intakeHash(manifest);
 if(expectedPin!==undefined&&expectedPin!==pin)throw new AppError('INTAKE_CHANGED');
 // Only the owning, authenticated proposal supplies these optional hints.
 // A completed digest is reusable only for the same manifest and checked
 // filesystem identity; staging still hashes every copied original in full.
 const saved=verification?.pin===pin&&verification.manifestStamp===known.stamp&&Array.isArray(verification.files)&&verification.files.length<=manifest.files.length?new Map(verification.files.map(f=>[f?.id,f])):new Map();
 const files=[],pending=[],total=manifest.files.reduce((n,f)=>n+f.size,0);let done=0,pendingBytes=0;
 const persist=async()=>{if(!pending.length)return;await checkpoint({pin,manifestStamp:known.stamp,files:pending.slice()});pending.length=0;pendingBytes=0;};
 for(const f of manifest.files){
  signal?.throwIfAborted();const stat=await intakeSourceFile(root,f.path),prior=saved.get(f.id);
  if(stat.size!==f.size)throw new AppError('INTAKE_CHANGED');
  if(prior?.path===f.path&&prior.size===f.size&&prior.sha256===f.sha256&&prior.stamp===stat.stamp){done+=f.size;await progress({stage:'validating',done,total,unit:'bytes'});}
  else{
   // Keep completed work durable before starting another large capture.
   if(f.size>=checkpointBytes)await persist();
   const hash=createHash('sha256');
   for await(const b of sourceChunks(root,f.path,stat,{signal})){hash.update(b);done+=b.length;await progress({stage:'validating',done,total,unit:'bytes'});}
   if(hash.digest('hex')!==f.sha256)throw new AppError('INTAKE_CHANGED');
   pending.push({id:f.id,path:f.path,size:f.size,sha256:f.sha256,stamp:stat.stamp});pendingBytes+=f.size;
   if(pending.length===32||pendingBytes>=checkpointBytes)await persist();
  }
  files.push({...f,...stat});
 }
 await persist();
 // Earlier files can change while later files or checkpoint writes finish.
 // Recheck the complete inspected set, including reused verification hints.
 const report={manifest,pin,root,files,manifestStamp:known.stamp};
 await assertIntakeUnchanged(report,{signal});return report;
}
export async function assertIntakeUnchanged(report,{signal}={}){
 signal?.throwIfAborted();
 if((await intakeSourceFile(report.root,INTAKE_MANIFEST)).stamp!==report.manifestStamp)throw new AppError('INTAKE_CHANGED');
 for(const f of report.files){signal?.throwIfAborted();if((await intakeSourceFile(report.root,f.path)).stamp!==f.stamp)throw new AppError('INTAKE_CHANGED');}
}
