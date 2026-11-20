import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {lstat,realpath,rmdir,unlink} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {createPersistentDirectory as mkdir} from './filesystem-persistence.js';
import {AppError} from './errors.js';
import {writePublicFile} from './file-content.js';

// Writes a set of public files into a folder that must not exist yet. The files
// are staged beside the destination and appear there in one rename, so a
// reader never sees a partly written folder and existing output is never
// overwritten. `beforeRename` can re-check the staged content.
export async function writeNewFolder(files,destination,{beforeRename=()=>{}}={}){
 const target=path.resolve(destination);
 await mkdir(path.dirname(target),{recursive:true});
 const parent=await realpath(path.dirname(target)),final=path.join(parent,path.basename(target));
 const absent=async()=>{try{await lstat(final);throw new AppError('EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}};
 await absent();
 const staging=path.join(parent,`.observanda-build-${randomUUID()}`);
 await mkdir(staging,{mode:0o700});
 try{
  for(const [name,content] of files){
   const file=path.join(staging,name);
   await mkdir(path.dirname(file),{recursive:true});
   await writePublicFile(file,content);
  }
  await beforeRename();
  // Recheck after staging: refuse any destination created in the meantime.
  await absent();
  await rename(staging,final);
 }finally{
  // Only known staging members are removed. No recursive removal of user paths.
  for(const name of files.keys())await unlink(path.join(staging,name)).catch(()=>{});
  const directories=new Set();
  for(const name of files.keys())for(let parent=path.dirname(name);parent!=='.';parent=path.dirname(parent))directories.add(parent);
  for(const name of [...directories].sort((a,b)=>b.length-a.length))await rmdir(path.join(staging,name)).catch(()=>{});
  await rmdir(staging).catch(()=>{});
 }
}
