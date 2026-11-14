import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,copyFile,mkdir,chmod,readlink,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SSHHost} from '../src/ssh-host.js';
const exec=promisify(execFile);
export async function sshFixture(t){
 // The simulated server folder must be a dedicated hosting directory: a POSIX
 // /tmp has a shared writable ancestor, and SSH folder names admit no spaces,
 // which a checkout path may contain. The user's cache folder serves both.
 const windows=process.platform==='win32',base=process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache');
 await mkdir(base,{recursive:true,mode:0o700});
 const directory=await mkdtemp(path.join(await realpath(base),'observanda-ssh-protocol-')),shell=windows?'C:/Program Files/Git/bin/bash.exe':'/bin/sh',env={...process.env,MSYS:'winsymlinks:nativestrict'};
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const root=windows?(await exec(shell,['-c','cygpath -u "$1"','sh',directory],{env,windowsHide:true})).stdout.trim():directory;
 let hook=null;const calls=[];
 const run=async(program,args,options={})=>{
  const call={program,args,options};calls.push(call);await hook?.(call,'before');let output='';
  if(program==='ssh')output=await new Promise((resolve,reject)=>{const child=execFile(shell,['-c',args.at(-1)],{env,windowsHide:true,maxBuffer:1024*1024,timeout:180000,signal:options.signal},(error,stdout,stderr)=>error?reject(Object.assign(error,{message:error.message+' '+stderr})):resolve(stdout));child.stdin.on('error',()=>{});if(options.input&&typeof options.input[Symbol.asyncIterator]==='function')pipeline(Readable.from(options.input),child.stdin).catch(error=>{child.kill();reject(error);});else child.stdin.end(options.input??'');});
  else if(program==='sftp')for(const line of options.input.trim().split('\n')){
   const match=/^put "([^"]+)" "([^"]+)"$/.exec(line);if(!match)throw Error('Unexpected SFTP command');
   if(!match[2].startsWith(root+'/'))throw Error('Fixture escaped remote root');const relative=match[2].slice(root.length+1),target=path.resolve(directory,relative);
   if(!target.startsWith(directory+path.sep))throw Error('Fixture escaped remote root');await copyFile(path.join(options.cwd,match[1]),target);await chmod(target,0o600);
  }else throw Error('Unexpected executable');
  await hook?.(call,'after');return output;
 };
 // Upload copies stay in this fixture's own folder, as in a workspace.
 const staging=path.join(directory,'staging'),host=new SSHHost(run),deploy=host.deploy.bind(host);host.deploy=(c,candidate,owner,options={})=>deploy(c,candidate,owner,{staging,...options});
 return {directory,root,run,staging,host,config:{host:'synthetic.example',user:'research',port:22,directory:root+'/site',identityFile:''},calls,setHook:value=>hook=value,current:()=>readlink(path.join(directory,'site','current'))};
}
