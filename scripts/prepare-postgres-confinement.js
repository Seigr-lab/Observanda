import {mkdir,mkdtemp,copyFile,chmod,rm,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {workDirectory} from './work-directory.js';

export async function preparePostgresConfinement({out,run}={}){
 if(process.platform!=='linux')return;
 out??=fileURLToPath(new URL('../.local/native-filesystem/linux-'+process.arch+'/postgres-confinement',import.meta.url));
 run??=(command,args,cwd)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,stdio:'inherit',shell:false});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('PostgreSQL confinement compilation failed')));});
 const parent=await workDirectory(),temporary=await mkdtemp(path.join(parent,'observanda-confinement-'));
 try{
  await copyFile(new URL('../src/security/postgres-confinement-linux.c',import.meta.url),path.join(temporary,'postgres-confinement.c'));
  await run('/usr/bin/cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-fstack-protector-strong','-D_FORTIFY_SOURCE=2','-Wl,-z,relro,-z,now','-o','postgres-confinement','postgres-confinement.c'],temporary);
  await mkdir(path.dirname(out),{recursive:true});await copyFile(path.join(temporary,'postgres-confinement'),out);await chmod(out,0o755);
 }finally{if(path.dirname(temporary)!==parent||await realpath(temporary)!==temporary)throw Error('Invalid confinement build cleanup');await rm(temporary,{recursive:true,force:true});}
 return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await preparePostgresConfinement();
