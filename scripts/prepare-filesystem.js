import {mkdir,mkdtemp,copyFile,rm,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {preparePostgresConfinement} from './prepare-postgres-confinement.js';
export async function prepareFilesystem({out,headers=process.env.OBSERVANDA_NODE_HEADERS??path.resolve(path.dirname(process.execPath),'../include/node'),run}={}){
 if(process.platform==='win32')return;
 if(!['linux','darwin'].includes(process.platform))throw Error('Unsupported filesystem target');
 out??=fileURLToPath(new URL('../.local/native-filesystem/'+process.platform+'-'+process.arch+'/mutation-files.node',import.meta.url));
 run??=(command,args,cwd)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,stdio:'inherit',shell:false});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Filesystem bridge compilation failed')));});
 const parent=await realpath(os.tmpdir()),temporary=await mkdtemp(path.join(parent,'observanda-filesystem-'));
 try{
  // Generic relative source names keep build-host paths out of the binary.
  await copyFile(new URL('../src/security/mutation-files-posix.c',import.meta.url),path.join(temporary,'mutation-files.c'));
  await run('/usr/bin/cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-fPIC','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=observanda_filesystem','-I',headers,...(process.platform==='darwin'?['-bundle','-undefined','dynamic_lookup']:['-shared']),'-o','mutation-files.node','mutation-files.c'],temporary);
  await mkdir(path.dirname(out),{recursive:true});await copyFile(path.join(temporary,'mutation-files.node'),out);
 }finally{if(path.dirname(temporary)!==parent||await realpath(temporary)!==temporary)throw Error('Invalid filesystem build cleanup');await rm(temporary,{recursive:true,force:true});}
 await preparePostgresConfinement({out:path.join(path.dirname(out),'postgres-confinement'),run});
 return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareFilesystem();
