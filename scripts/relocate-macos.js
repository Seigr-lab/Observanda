import {readdir,lstat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const run=promisify(execFile);
export async function relocateMacLibraries(directory){
 await access('/usr/bin/otool',constants.X_OK);await access('/usr/bin/install_name_tool',constants.X_OK);
 const root=path.resolve(directory);
 async function walk(folder){for(const name of await readdir(folder)){const file=path.join(folder,name),stat=await lstat(file);if(stat.isSymbolicLink())continue;if(stat.isDirectory()){await walk(file);continue;}if(!stat.isFile())continue;
   let stdout;try{({stdout}=await run('/usr/bin/otool',['-L',file]));}catch{continue;}
   for(const line of stdout.split('\n').slice(1)){const dependency=line.trim().split(' (compatibility version')[0];if(!dependency)continue;
     if(dependency.startsWith(root+'/'))await run('/usr/bin/install_name_tool',['-change',dependency,'@loader_path/'+path.relative(path.dirname(file),dependency),file]);
     else if(!['/usr/lib/','/System/Library/','@loader_path/','@rpath/','@executable_path/'].some(prefix=>dependency.startsWith(prefix)))throw Error('Unbundled macOS dependency: '+dependency);
   }
   if(file.endsWith('.dylib'))await run('/usr/bin/install_name_tool',['-id','@rpath/'+path.basename(file),file]);
 }}await walk(root);
}
