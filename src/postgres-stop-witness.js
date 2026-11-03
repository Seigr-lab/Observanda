import path from 'node:path';
import {createHash} from 'node:crypto';

// A stopped server can leave its lock file after a hard crash. Only the
// Windows guard that actually launched the server can mint a local ticket.
export async function localStopWitness({guard,config,workspace,data,verify=false}){
 if(!workspace||!guard.stopWitness||config.ownerId!==workspace.ownerId||!config.running||verify&&(!workspace.deleteId||typeof config.localStopTicket!=='string'))return null;
 const {files}=guard,pidFile=path.join(data,'postmaster.pid');
 const file=await files.readIdentified(pidFile,16384).catch(error=>{if(error.code==='ENOENT'||error.code==='LIMIT')return null;throw error;});
 if(!file)return null;
 const {bytes}=file,lines=bytes.toString('utf8').split(/\r?\n/u);
 const pid=Number(lines[0]),port=Number(lines[3]),start=Number(lines[2]);
 if(!Number.isSafeInteger(pid)||pid<=0||pid>0x7fffffff||!Number.isSafeInteger(start)||start<=0||port!==config.port||!lines[1]||path.resolve(lines[1]).toLowerCase()!==data.toLowerCase())return null;
 const cluster=await files.stat(data,{directory:true}),stamp=createHash('sha256').update(bytes).digest('hex');
 if(![guard.identity,cluster.identity,file.identity].every(value=>typeof value==='string'&&value.length>0))return null;
 const binding=createHash('sha256').update(JSON.stringify([workspace.vault.id,workspace.ownerId,data,guard.identity,cluster.identity,file.identity,pid,start,port,stamp])).digest('hex');
 return guard.stopWitness({pid,port,binding,ticket:verify?config.localStopTicket:null});
}
