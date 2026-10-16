import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,copyFile,mkdir,readlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SSHHost} from '../src/ssh-host.js';
const exec=promisify(execFile);
export async function sshFixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-ssh-protocol-')),shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh',env={...process.env,MSYS:'winsymlinks:nativestrict'};
 const root=process.platform==='win32'?(await exec(shell,['-c','cygpath -u "$1"','sh',directory],{env,windowsHide:true})).stdout.trim():directory;
 t.after(()=>rm(directory,{recursive:true,force:true}));
 let hook=null;const calls=[];
 const run=async(program,args,options={})=>{
  const call={program,args,options};calls.push(call);await hook?.(call,'before');let output='';
  if(program==='ssh')output=await new Promise((resolve,reject)=>{const child=execFile(shell,['-c',args.at(-1)],{env,windowsHide:true,maxBuffer:1024*1024,timeout:180000,signal:options.signal},(error,stdout,stderr)=>error?reject(Object.assign(error,{message:error.message+' '+stderr})):resolve(stdout));child.stdin.on('error',()=>{});child.stdin.end(options.input??'');});
  else if(program==='sftp')for(const line of options.input.trim().split('\n')){
   const match=/^put "([^"]+)" "([^"]+)"$/.exec(line);if(!match)throw Error('Unexpected SFTP command');
   if(!match[2].startsWith(root+'/'))throw Error('Fixture escaped remote root');const relative=match[2].slice(root.length+1),target=path.resolve(directory,relative);
   if(!target.startsWith(directory+path.sep))throw Error('Fixture escaped remote root');await copyFile(path.join(options.cwd,match[1]),target);
  }else throw Error('Unexpected executable');
  await hook?.(call,'after');return output;
 };
 return {directory,root,run,host:new SSHHost(run),config:{host:'synthetic.example',user:'research',port:22,directory:root+'/site',identityFile:''},calls,setHook:value=>hook=value,current:()=>readlink(path.join(directory,'site','current'))};
}
