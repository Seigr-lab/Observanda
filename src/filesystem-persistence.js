import {open} from 'node:fs/promises';
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
