import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from '../errors.js';
import {checkedSourcePath,sourceChunks,sourceStamp} from '../migration/source-files.js';
import {INTAKE_MANIFEST,INTAKE_LIMIT,validateIntake,intakeHash} from './contract.js';
export async function intakeSourceFile(root,name){
 const s=await lstat(await checkedSourcePath(root,name),{bigint:true});
 if(!s.isFile()||s.size>BigInt(Number.MAX_SAFE_INTEGER))throw new AppError('INTAKE_INVALID');
 return {size:Number(s.size),stamp:sourceStamp(s)};
}
export async function inspectIntake(source,{signal,expectedPin,progress=async()=>{}}={}){
 if(typeof source!=='string'||!path.isAbsolute(source))throw new AppError('INTAKE_INVALID');
 const root=path.resolve(source),known=await intakeSourceFile(root,INTAKE_MANIFEST);
 if(known.size>INTAKE_LIMIT)throw new AppError('LIMIT');
 const chunks=[];for await(const b of sourceChunks(root,INTAKE_MANIFEST,known,{signal}))chunks.push(b);
 let manifest;try{manifest=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('INTAKE_INVALID');}
 validateIntake(manifest);const pin=intakeHash(manifest);
 if(expectedPin!==undefined&&expectedPin!==pin)throw new AppError('INTAKE_CHANGED');
 const files=[],total=manifest.files.reduce((n,f)=>n+f.size,0);let done=0;
 for(const f of manifest.files){
  signal?.throwIfAborted();const stat=await intakeSourceFile(root,f.path),hash=createHash('sha256');
  if(stat.size!==f.size)throw new AppError('INTAKE_CHANGED');
  for await(const b of sourceChunks(root,f.path,stat,{signal})){hash.update(b);done+=b.length;await progress({stage:'validating',done,total,unit:'bytes'});}
  if(hash.digest('hex')!==f.sha256)throw new AppError('INTAKE_CHANGED');files.push({...f,...stat});
 }
 // The manifest must still describe the files we just verified.
 if((await intakeSourceFile(root,INTAKE_MANIFEST)).stamp!==known.stamp)throw new AppError('INTAKE_CHANGED');
 return {manifest,pin,root,files,manifestStamp:known.stamp};
}
export async function assertIntakeUnchanged(report){
 if((await intakeSourceFile(report.root,INTAKE_MANIFEST)).stamp!==report.manifestStamp)throw new AppError('INTAKE_CHANGED');
 for(const f of report.files)if((await intakeSourceFile(report.root,f.path)).stamp!==f.stamp)throw new AppError('INTAKE_CHANGED');
}
