// Old directory locks have no provable owner. Recovery requires the local
// user's acknowledgement that all other installations using this path stopped.
import path from 'node:path';
import {readdir,rmdir,realpath,lstat} from 'node:fs/promises';
import {digest,serialize} from './storage-format.js';
import {legacyWriterLock,withWriterLease} from './writer-lease.js';
import {AppError} from './errors.js';

export async function reviewWriterRecovery(file){
 if(!file||!await legacyWriterLock(file))return null;
 if(await realpath(path.dirname(file))!==path.dirname(file)||(await readdir(file)).length)throw new AppError('UNSAFE');
 const stat=await lstat(file);
 return {path:file,stamp:digest(serialize({file,ino:stat.ino,dev:stat.dev,ctime:stat.ctimeMs,mtime:stat.mtimeMs}))};
}
export async function recoverWriter(file,command){
 if(command?.closedOtherInstallations!==true)throw new AppError('INVALID');
 const current=await reviewWriterRecovery(file);
 if(!current||command.stamp!==current.stamp)throw new AppError('CONFLICT');
 // Empty-directory removal cannot remove data, links or nested files. A new
 // legacy writer winning the next race is reported, never removed again.
 await rmdir(file);
 await withWriterLease(file,async()=>{});
 return {recovered:true};
}
