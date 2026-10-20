import {fork} from 'node:child_process';

export async function interruptWorkspace(root,vault,point,operation={}, {checkpointTimeoutMs=20000}={}){
 const child=fork(new URL('./catalogue-interruption.js',import.meta.url),[],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 const exited=new Promise(resolve=>child.once('exit',resolve));
 try{
  return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Child did not reach '+point+': '+errors)),checkpointTimeoutMs);
   const finish=(callback,value)=>{clearTimeout(timer);callback(value);};
   child.once('error',error=>finish(reject,error));
   child.once('exit',()=>finish(reject,Error('Child exited before checkpoint: '+errors)));
   child.once('message',message=>message.type==='checkpoint'?finish(resolve,message):finish(reject,Error(JSON.stringify(message))));
   child.send({root,vault:{id:vault.id,key:vault.key.toString('base64')},point,...operation});
  });
 }finally{
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  await exited;
 }
}
