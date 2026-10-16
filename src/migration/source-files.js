import path from 'node:path';
import {constants} from 'node:fs';
import {lstat,realpath,open} from 'node:fs/promises';
import {AppError} from '../errors.js';

export const sourceStamp=s=>[s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
export const unsafeSource=s=>s.isSymbolicLink()||!s.isDirectory()&&(!s.isFile()||s.nlink>1n);
export const checkSourceSignal=signal=>{if(signal?.aborted)throw new AppError('INVENTORY_CANCELLED');};
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
export async function checkedSourcePath(root,relative=''){
 let at=path.parse(root).root;
 for(const segment of path.relative(at,path.join(root,relative)).split(path.sep).filter(Boolean)){
  at=path.join(at,segment);const s=await lstat(at,{bigint:true});
  if(unsafeSource(s)||!samePath(await realpath(at),at))throw new AppError('UNSAFE');
 }
 return at;
}
// Every consumer reads the same checked object. No links, writes or execution.
export async function* sourceChunks(root,name,known,{signal}={}){
 checkSourceSignal(signal);const filename=await checkedSourcePath(root,name);
 const file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const before=await file.stat({bigint:true});
  if(unsafeSource(before)||sourceStamp(before)!==known.stamp)throw new AppError('INVENTORY_CHANGED');
  let bytes=0;
  for(;;){
   checkSourceSignal(signal);const buffer=Buffer.alloc(64*1024),{bytesRead}=await file.read(buffer,0,buffer.length,null);
   if(!bytesRead)break;
   bytes+=bytesRead;if(bytes>known.size)throw new AppError('INVENTORY_CHANGED');
   yield buffer.subarray(0,bytesRead);
  }
  if(bytes!==known.size)throw new AppError('INVENTORY_CHANGED');
 }finally{
  try{
   if(sourceStamp(await file.stat({bigint:true}))!==known.stamp)throw new AppError('INVENTORY_CHANGED');
   await checkedSourcePath(root,name);
   if(sourceStamp(await lstat(filename,{bigint:true}))!==known.stamp)throw new AppError('INVENTORY_CHANGED');
  }finally{await file.close();}
 }
}
