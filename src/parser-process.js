import {access,lstat,realpath,mkdtemp,chmod,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {AppError} from './errors.js';

// This limits inherited authority and incidental file access. It is not an OS
// sandbox: a compromised native executable still has this user's OS identity.
export async function parserExecutable(binary,{env=process.env,platform=process.platform}={}){
 if(typeof binary!=='string'||!binary||binary.includes('\0'))throw new AppError('MEDIA_TOOL');
 const absolute=path.isAbsolute(binary);
 if(!absolute&&!['ffmpeg','ffprobe'].includes(binary))throw new AppError('MEDIA_TOOL');
 const search=Object.entries(env).find(([key])=>key.toUpperCase()==='PATH')?.[1]??'';
 const candidates=absolute?[binary]:search.split(path.delimiter).filter(directory=>path.isAbsolute(directory)).map(directory=>path.join(directory,binary+(platform==='win32'?'.exe':'')));
 for(const candidate of candidates){
  try{const file=await realpath(candidate),stat=await lstat(file);if(!stat.isFile())continue;await access(file,platform==='win32'?constants.R_OK:constants.X_OK);return file;}
  catch(error){if(!['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))throw error;}
 }
 throw new AppError('MEDIA_TOOL');
}
export function parserEnvironment(executable,directory,{env=process.env,platform=process.platform}={}){
 const result={PATH:path.dirname(executable),HOME:directory,USERPROFILE:directory,TMPDIR:directory,TEMP:directory,TMP:directory,LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
 if(platform==='win32'){
  const system=Object.entries(env).find(([key])=>key.toUpperCase()==='SYSTEMROOT')?.[1];
  if(system&&path.isAbsolute(system)){result.SystemRoot=system;result.WINDIR=system;}
 }
 return result;
}
export async function parserProcess(binary){
 const executable=await parserExecutable(binary),parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-parser-'));
 try{await chmod(directory,0o700);}catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 let closed=false;
 return {executable,cwd:directory,env:parserEnvironment(executable,directory),async close(){if(closed)return;closed=true;if(path.dirname(directory)!==parent||await realpath(directory)!==directory)throw new AppError('UNSAFE');await rm(directory,{recursive:true,force:true,maxRetries:2});}};
}
