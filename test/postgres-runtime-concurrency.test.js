import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer,createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {startManagedPostgres} from '../src/postgres-runtime.js';

// Every workspace, project and lab book owns a cluster, and several start and
// stop at once. Each cluster chooses a free local port before PostgreSQL binds
// it, while ordinary connections keep taking ports from the same range.
const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function parent(t,prefix){const directory=await mkdtemp(path.join(os.tmpdir(),prefix));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return directory;}
async function logTail(directory){try{return (await readFile(path.join(directory,'postgresql.log'),'utf8')).slice(-600);}catch{return '';}}
// Short-lived loopback connections consume dynamic local ports continuously.
function churnPorts(){
 const server=createServer(socket=>socket.destroy());let stopped=false,connections=0;
 const ready=new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const loop=ready.then(async()=>{const {port}=server.address();while(!stopped){await Promise.all(Array.from({length:32},()=>new Promise(resolve=>{const socket=createConnection({port,host:'127.0.0.1'},()=>{connections++;socket.destroy();});socket.once('close',resolve);socket.once('error',resolve);})));}});
 return {connections:()=>connections,stop:async()=>{stopped=true;await loop;await new Promise(resolve=>server.close(resolve));}};
}

test('concurrent managed clusters start and stop while local ports are in use',{timeout:900000},async t=>{
 const root=await parent(t,'observanda-runtime-concurrency-'),clusters=Array.from({length:6},(_,index)=>path.join(root,'cluster-'+index)),churn=churnPorts(),failures=[];let attempts=0;
 try{
  for(let round=0;round<4;round++){
   const services=await Promise.all(clusters.map(async directory=>{attempts++;try{return await startManagedPostgres({directory,env:environment()});}catch(error){failures.push({round,directory,phase:'start',code:error.code,log:await logTail(directory)});return null;}}));
   await Promise.all(services.map(async(service,index)=>{if(!service)return;try{await service.close();}catch(error){failures.push({round,directory:clusters[index],phase:'stop',code:error.code,log:await logTail(clusters[index])});}}));
  }
 }finally{await churn.stop();}
 t.diagnostic('cluster starts '+attempts+', failures '+failures.length+', loopback connections '+churn.connections());
 assert.deepEqual(failures,[]);
});

test('a managed cluster whose server already exited still stops and restarts',{timeout:300000},async t=>{
 const root=await parent(t,'observanda-runtime-exited-'),directory=path.join(root,'cluster');
 for(let attempt=0;attempt<3;attempt++){
  const service=await startManagedPostgres({directory,env:environment()});
  // The server process ends outside the manager, for example when its process
  // group is torn down while the stop request is under way.
  const pid=Number((await readFile(path.join(directory,'data','postmaster.pid'),'utf8')).split(/\r?\n/)[0]);assert.ok(Number.isSafeInteger(pid)&&pid>0);
  process.kill(pid,'SIGKILL');
  for(const deadline=Date.now()+30000;Date.now()<deadline;){try{process.kill(pid,0);await new Promise(resolve=>setTimeout(resolve,50));}catch{break;}}
  await service.close();
 }
 const service=await startManagedPostgres({directory,env:environment()});await service.close();
});

test('a cluster left by a killed application restarts at once',{timeout:600000},async t=>{
 const root=await parent(t,'observanda-runtime-killed-'),directory=path.join(root,'cluster'),failures=[];
 const script="import {startManagedPostgres} from './src/postgres-runtime.js';const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;await startManagedPostgres({directory:process.argv[1],env});process.stdout.write('ready');await new Promise(()=>{});";
 for(let attempt=0;attempt<5;attempt++){
  const child=spawn(process.execPath,['--input-type=module','-e',script,directory],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']}),exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',()=>reject(Error('Cluster owner exited early: '+errors)));});
  child.kill('SIGKILL');await exited;
  // The next owner starts immediately, while the killed owner's helpers and
  // server may still be shutting down.
  try{const service=await startManagedPostgres({directory,env:environment()});await service.close();}catch(error){failures.push({attempt,code:error.code,log:await logTail(directory)});}
 }
 assert.deepEqual(failures,[]);
});
