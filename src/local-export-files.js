// Local publication owns named output files, never a directory or Git checkout.
import path from 'node:path';
import {open,lstat,realpath,mkdir,link,rename,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {writePublicFile} from './file-content.js';

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
export async function memberPath(root,name,{create=false}={}){
 outputName(name);await regular(root,{directory:true});let current=root;
 for(const part of name.split('/').slice(0,-1)){
  current=path.join(current,part);
  if(create)await mkdir(current).catch(error=>{if(error.code!=='EEXIST')throw error;});
  if(!await regular(current,{directory:true,missing:!create}))return null;
 }
 return path.join(root,name);
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
async function installedFingerprint(file,stage){
 const stat=await regular(file,{missing:true,links:true});if(!stat)return null;
 if(stat.nlink!==1n){const source=await regular(stage,{missing:true,links:true});if(stat.nlink!==2n||source?.ino!==stat.ino||source.dev!==stat.dev)throw new AppError('UNSAFE');}
 return fingerprint(file,{links:true});
}
async function removeMatching(file,expected,{links=false}={}){
 const actual=await fingerprint(file,{links});if(actual===null)return;
 if(!sameFile(actual,expected))throw new AppError('LOCAL_EXPORT_CHANGED');await unlink(file);
}
// All new bytes are flushed and checked before any existing output is moved.
export async function stageFiles(plan,candidate,checkpoint,changes=()=>plan.changes){
 for await(const change of changes()){
  if(!change.after||change.kind==='unchanged')continue;
  const file=await memberPath(plan.directory,change.path,{create:true}),stage=temporary(file,plan.id,'new');
  const existing=await fingerprint(stage);
  if(existing){if(sameFile(existing,change.after))continue;await unlink(stage);}
  await writePublicFile(stage,await candidate.files.get(change.path));await checkpoint('staged',change.path);
 }
}
export async function checkOriginals(plan,changes=()=>plan.changes){
 for await(const change of changes())if(!sameFile(await fingerprint(await memberPath(plan.directory,change.path)),change.before))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
}
// Recoverable per-file switch. A new file is installed with no-clobber link,
// not rename-over-destination. Originals remain alongside it until the entire
// edition is verified and its encrypted ownership receipt is committed.
export async function applyFiles(plan,checkpoint,applied,changes=()=>plan.changes){
 let ordinal=0;
 for await(const change of changes()){
  const index=ordinal++;
  const file=await memberPath(plan.directory,change.path,{create:!!change.after});
  if(!file){if(change.after===null&&index<plan.applied){await applied(index+1);continue;}throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);}
  const old=temporary(file,plan.id,'old'),stage=temporary(file,plan.id,'new');
  let actual=await installedFingerprint(file,stage),backup=await fingerprint(old);
  if(index<plan.applied&&!sameFile(actual,change.after))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
  if(sameFile(actual,change.after)){
   if(backup&&!sameFile(backup,change.before))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
   if(change.kind!=='unchanged'&&index>=plan.applied){
    if(change.before&&!backup)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
    if(change.after){const a=await regular(file,{links:true}),b=await regular(stage,{missing:true,links:true});if(!b||a.ino!==b.ino||a.dev!==b.dev)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);}
   }
   await applied(index+1);continue;
  }
  if(change.kind==='unchanged'||actual&&!sameFile(actual,change.before)||backup&&!sameFile(backup,change.before)||actual&&backup)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
  if(actual){
   await regular(file);await rename(file,old);await checkpoint('moved',change.path);
   backup=await fingerprint(old);
   if(!sameFile(backup,change.before)){
    // A writer raced the last hash. Put its bytes back only if still vacant.
    await link(old,file).then(()=>unlink(old)).catch(()=>{});
    throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
   }
  }else if(change.before&&!backup)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
  if(change.after){
   if(!sameFile(await fingerprint(stage,{links:true}),change.after))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
   await link(stage,file);await checkpoint('installed',change.path);
  }
  await applied(index+1);
 }
 for await(const change of changes()){const file=await memberPath(plan.directory,change.path);if(!sameFile(file?await installedFingerprint(file,temporary(file,plan.id,'new')):null,change.after))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);}
}
export async function cleanFiles(plan,changes=()=>plan.changes){
 for await(const change of changes()){
  const file=await memberPath(plan.directory,change.path);if(!file)continue;
  await removeMatching(temporary(file,plan.id,'new'),change.after,{links:true});
  await removeMatching(temporary(file,plan.id,'old'),change.before);
 }
}
