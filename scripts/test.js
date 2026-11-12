// Isolated PostgreSQL; never inherit a running application's database URL.
import {checkNodeVersion} from './node-version.js';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {workDirectory} from './work-directory.js';
import {spawn} from 'node:child_process';
import {startManagedPostgres} from '../src/postgres-runtime.js';
import {nativeTestArguments} from './test-selection.js';
import {prepareFilesystem} from './prepare-filesystem.js';
const controller=new AbortController();let child,service,directory,temporaryRuntime,temporaryRoot;
const stop=()=>{controller.abort();child?.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 checkNodeVersion();
 await prepareFilesystem();
 const args=process.argv.slice(2),browser=args[0]==='--browser';if(browser)args.shift();
 const commandArgs=browser?['node_modules/@playwright/test/cli.js','test',...args]:['--test','--test-reporter=tap','--test-concurrency=4',...await nativeTestArguments(args)];
 // Every test file, fixture workspace and the test database live inside this
 // checkout (the git-ignored .local/test-work), never in the system temporary
 // folder, so a run's material stays with the repository and survives a crash.
 // Tests read os.tmpdir(), which follows TMPDIR/TMP/TEMP. Fixtures compare
 // canonical workspace paths, so the root is resolved before owners are made.
 temporaryRoot=await workDirectory('test-work');
 const env={...process.env,TMPDIR:temporaryRoot,TMP:temporaryRoot,TEMP:temporaryRoot,OBSERVANDA_DATABASE_URL:process.env.OBSERVANDA_TEST_DATABASE_URL??'',OBSERVANDA_DATABASE_TLS:process.env.OBSERVANDA_TEST_DATABASE_TLS??'',OBSERVANDA_DATABASE_CA:process.env.OBSERVANDA_TEST_DATABASE_CA??''};
 if(!env.OBSERVANDA_DATABASE_URL){
  temporaryRuntime=await mkdtemp(path.join(temporaryRoot,'observanda-postgres-test-'));directory=path.join(temporaryRuntime,'database');
  if(env.OBSERVANDA_TEST_POSTGRES_BIN)env.OBSERVANDA_POSTGRES_BIN=env.OBSERVANDA_TEST_POSTGRES_BIN;
  // The PostgreSQL runtime is unpacked once per checkout into .local/test-runtime
  // and reused by every run; each run still gets its own fresh database.
  service=await startManagedPostgres({directory,runtimeDirectory:await workDirectory('test-runtime'),env,signal:controller.signal,onProgress:({stage,percent})=>{if(stage==='download'&&percent%10===0)console.log('Installing test PostgreSQL: '+percent+'%');}});
  env.OBSERVANDA_TEST_POSTGRES_BIN=service.bin;
 }
 console.log('Testing with an isolated PostgreSQL database.');
 await new Promise((resolve,reject)=>{
  child=spawn(process.execPath,commandArgs,{windowsHide:true,stdio:'inherit',env,signal:controller.signal});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error('Test command failed ('+(signal??code)+').')));
 });
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 try{await service?.close();}catch(error){console.error(error.message);process.exitCode=1;temporaryRuntime=null;}
 if(temporaryRuntime&&path.dirname(path.resolve(temporaryRuntime))===path.resolve(temporaryRoot)&&path.basename(temporaryRuntime).startsWith('observanda-postgres-test-'))await rm(temporaryRuntime,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
