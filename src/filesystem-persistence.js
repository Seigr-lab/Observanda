import {open,mkdir,unlink,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {AppError} from './errors.js';

// Node does not expose a qualified Windows directory persistence primitive.
// File flushes and atomic visibility still apply there; do not report them as
// a power-loss guarantee for directory entries or a remote storage server.
export function filesystemPersistence(platform=process.platform){
 return {fileFlush:true,directoryFlush:platform==='win32'?'unavailable':'fsync',powerLossQualified:false};
}

export async function syncDirectory(directory,{platform=process.platform,openDirectory=open}={}){
 if(platform==='win32')return false;
 const flags=constants.O_RDONLY|(constants.O_DIRECTORY??0)|(constants.O_NOFOLLOW??0),handle=await openDirectory(directory,flags);
 let failure;
 try{await handle.sync();}catch(error){failure=error;}
 try{await handle.close();}catch(error){failure??=error;}
 if(failure)throw failure;return true;
}

export async function persistDirectories(directories,{platform=process.platform,sync=syncDirectory}={}){
 try{for(const directory of new Set(directories.map(value=>path.resolve(value))))await sync(directory,{platform});}
 catch(cause){
  // A namespace mutation has already happened. Never retry that mutation or
  // remove the new destination as though it had not been published.
  const error=new AppError('DURABILITY_UNCERTAIN');error.cause=cause;error.commitUncertain=true;throw error;
 }
}

export async function persistRename(source,destination,options){
 await persistDirectories([path.dirname(destination),path.dirname(source)],options);
}

export async function persistDirectoryCreation(directory,options){
 await persistDirectories([directory,path.dirname(directory)],options);
}

export async function createPersistentDirectory(directory,options={}){
 const first=await mkdir(directory,options);if(options.recursive&&!first)return first;
 // Recursive mkdir can return a Windows namespaced path even when its input
 // used a normal drive path. Compare both in the same native representation.
 const boundary=path.toNamespacedPath(path.resolve(options.recursive?first:directory)),directories=[];let current=path.toNamespacedPath(path.resolve(directory));
 for(;;){directories.push(current);if(current===boundary)break;const parent=path.dirname(current);if(parent===current)throw new AppError('UNSAFE');current=parent;}
 directories.push(path.dirname(boundary));await persistDirectories(directories);return first;
}

export async function unlinkPersistent(file){
 await unlink(file);await persistDirectories([path.dirname(file)]);
}

export async function removePersistentDirectory(directory){
 await rmdir(directory);await persistDirectories([path.dirname(directory)]);
}
