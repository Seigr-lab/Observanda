// A filesystem lease coordinates different installations sharing a workspace,
// including SMB shares. The OS releases it when the owning process exits.
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AppError} from './errors.js';
import {assertRegular} from './storage.js';
export async function workspaceDatabaseLease(directory,{file,busyCode='DATABASE_RUNNING'}={}){
 const lock=file??path.join(directory,'owner.lock');await assertRegular(lock,{missing:true});
 const windows=process.platform==='win32',command=windows?path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):'/usr/bin/perl';
 const args=windows?['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/workspace-database-lock.ps1',import.meta.url)),'-LockFile',lock]:[fileURLToPath(new URL('./security/database-lock.pl',import.meta.url)),lock];
 const child=spawn(command,args,{windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
 const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(null));});child.stdin.on('error',()=>{});
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(new AppError('DATABASE_RUNTIME'));},10000);
  child.once('error',()=>{clearTimeout(timer);reject(new AppError('DATABASE_LOCK_TOOLS'));});
  child.once('exit',code=>{clearTimeout(timer);reject(new AppError(code===73?busyCode:'DATABASE_RUNTIME'));});
  let result='';child.stdout.on('data',bytes=>{result+=bytes.toString();if(result.includes('\n')){clearTimeout(timer);result.trim()==='locked'?resolve():reject(new AppError('DATABASE_RUNTIME'));}});
 });}catch(error){child.stdin.end();await exited;throw error;}
 let closing;return {close:()=>closing??=(async()=>{child.stdin.end();await exited;})()};
}
