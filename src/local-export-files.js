// Local publication owns named output files, never a directory or Git checkout.
import path from 'node:path';
import {open,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {stageNativeFiles,checkNativeOriginals,applyNativeFiles,cleanNativeFiles} from './local-export-native-files.js';

export const sameFile=(a,b)=>a===null||b===null?a===b:a.bytes===b.bytes&&a.sha256===b.sha256;
export function outputName(name){
 if(typeof name!=='string'||name.length>500||name!==name.normalize('NFC')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f<>"|?*]/.test(p)||/[. ]$/.test(p)||/^\./.test(p)&&p!=='.nojekyll'||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw new AppError('UNSAFE');
 return name;
}
export function within(parent,child){const relative=path.relative(parent,child);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
export async function regular(file,{directory=false,missing=false,links=false}={}){
 try{const stat=await lstat(file,{bigint:true});if(stat.isSymbolicLink()||!(directory?stat.isDirectory():stat.isFile())||!directory&&!links&&stat.nlink!==1n)throw new AppError('UNSAFE');return stat;}
 catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}
}
export async function destinationDirectory(value){
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw new AppError('INVALID');
 const resolved=path.resolve(value),base=path.parse(resolved).root;
 if(resolved===base)throw new AppError('UNSAFE');
 let current=base;await regular(current,{directory:true});
 for(const part of path.relative(base,resolved).split(path.sep)){
  if(/^\.(git|observanda)$/i.test(part))throw new AppError('UNSAFE');
  current=path.join(current,part);await regular(current,{directory:true});
 }
 return realpath(resolved);
}
export async function fingerprint(file,{links=false}={}){
 const named=file&&await regular(file,{missing:true,links});if(!named)return null;
 const handle=await open(file,'r');
 try{
  const before=await handle.stat({bigint:true});if(!before.isFile()||before.ino!==named.ino||before.dev!==named.dev||!links&&before.nlink!==1n)throw new AppError('UNSAFE');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of handle.createReadStream({autoClose:false})){hash.update(chunk);bytes+=chunk.length;}
  const after=await handle.stat({bigint:true});
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new AppError('LOCAL_EXPORT_CHANGED');
  return {bytes,sha256:hash.digest('hex')};
 }finally{await handle.close();}
}
export const temporary=(file,id,kind)=>path.join(path.dirname(file),'.observanda-'+id+'-'+kind+'-'+path.basename(file));
// Supported platforms use the same anchored implementation. Unsupported
// platforms fail closed in withNativeExport instead of mutating pathnames.
export const stageFiles=(plan,candidate,checkpoint,changes=()=>plan.changes)=>stageNativeFiles(plan,candidate,checkpoint,changes);
export const checkOriginals=(plan,changes=()=>plan.changes)=>checkNativeOriginals(plan,changes);
export const applyFiles=(plan,checkpoint,applied,changes=()=>plan.changes)=>applyNativeFiles(plan,checkpoint,applied,changes);
export const cleanFiles=(plan,changes=()=>plan.changes)=>cleanNativeFiles(plan,changes);
