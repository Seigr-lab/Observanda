import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {AppError} from '../errors.js';

// Identity recovery only. Follow the existing managed-runtime kernel-lease
// pattern without changing database startup or its locking contract.
export async function identityLease(identity,{lockFile,wait=20000}={}){
 const deadline=Date.now()+wait;
 for(;;){try{return await acquire(identity,lockFile);}catch(error){if(error.code!=='LOCKED'||Date.now()>=deadline)throw error;await delay(50);}}
}
async function acquire(identity,lockFile){
 const windows=process.platform==='win32',name='observanda-identity-'+createHash('sha256').update(windows?identity.toLowerCase():identity).digest('hex');
 if(windows||process.platform==='linux'){
  const server=createServer(socket=>socket.destroy());
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(windows?'\\\\.\\pipe\\'+name:'\0'+name,resolve);});}
  catch(error){throw new AppError(error.code==='EADDRINUSE'?'LOCKED':'DEVICE_UNAVAILABLE');}
  let closed=false;return {close:async()=>{if(closed)return;closed=true;await new Promise(resolve=>server.close(resolve));}};
 }
 if(process.platform!=='darwin'||!lockFile)throw new AppError('DEVICE_UNAVAILABLE');
 // The existing flock helper releases on stdin EOF, including parent failure.
 // Keep the inode, so all processes lock the same file.
 const child=spawn('/usr/bin/perl',[fileURLToPath(new URL('../security/database-lock.pl',import.meta.url)),lockFile],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(null));});child.stdin.on('error',()=>{});
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(new AppError('DEVICE_UNAVAILABLE'));},5000);
  child.once('error',()=>{clearTimeout(timer);reject(new AppError('DEVICE_UNAVAILABLE'));});
  child.once('exit',code=>{clearTimeout(timer);reject(new AppError(code===73?'LOCKED':'DEVICE_UNAVAILABLE'));});
  child.stdout.once('data',data=>{clearTimeout(timer);data.toString()==='locked\n'?resolve():reject(new AppError('DEVICE_UNAVAILABLE'));});
 });}catch(error){child.stdin.end();await exited;throw error;}
 return {close:async()=>{child.stdin.end();await exited;}};
}
