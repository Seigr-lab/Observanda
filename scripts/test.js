// Isolated PostgreSQL; never inherit a running application's database URL.
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {startManagedPostgres} from '../src/postgres-runtime.js';
const controller=new AbortController();let child,service,directory;
const stop=()=>{controller.abort();child?.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 // Fixtures compare canonical workspace paths. Resolve runner aliases such as
 // macOS /var and Windows short-user paths before creating temporary owners.
 const temporaryRoot=await realpath(os.tmpdir());
 const env={...process.env,TMPDIR:temporaryRoot,TMP:temporaryRoot,TEMP:temporaryRoot,OBSERVANDA_DATABASE_URL:process.env.OBSERVANDA_TEST_DATABASE_URL??'',OBSERVANDA_DATABASE_TLS:process.env.OBSERVANDA_TEST_DATABASE_TLS??'',OBSERVANDA_DATABASE_CA:process.env.OBSERVANDA_TEST_DATABASE_CA??''};
 if(!env.OBSERVANDA_DATABASE_URL){
  directory=await mkdtemp(path.join(os.tmpdir(),'observanda-postgres-test-'));
  if(env.OBSERVANDA_TEST_POSTGRES_BIN)env.OBSERVANDA_POSTGRES_BIN=env.OBSERVANDA_TEST_POSTGRES_BIN;
  service=await startManagedPostgres({directory,env,signal:controller.signal,onProgress:({stage,percent})=>{if(stage==='download'&&percent%10===0)console.log('Installing test PostgreSQL: '+percent+'%');}});
  env.OBSERVANDA_TEST_POSTGRES_BIN=service.bin;
 }
 const args=process.argv.slice(2),browser=args[0]==='--browser';if(browser)args.shift();
 const commandArgs=browser?['node_modules/@playwright/test/cli.js','test',...args]:['--test','--test-reporter=tap','--test-concurrency=4',...(args.length?args:['test/*.test.js'])];
 console.log('Testing with an isolated PostgreSQL database.');
 await new Promise((resolve,reject)=>{
  child=spawn(process.execPath,commandArgs,{windowsHide:true,stdio:'inherit',env,signal:controller.signal});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error('Test command failed ('+(signal??code)+').')));
 });
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 try{await service?.close();}catch(error){console.error(error.message);process.exitCode=1;directory=null;}
 if(directory&&path.dirname(path.resolve(directory))===path.resolve(os.tmpdir())&&path.basename(directory).startsWith('observanda-postgres-test-'))await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
