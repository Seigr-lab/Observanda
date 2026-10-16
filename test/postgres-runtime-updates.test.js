import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rename,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from 'pg';
import {findPostgres,startManagedPostgres} from '../src/postgres-runtime.js';

async function query(env,sql){
 const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL});
 await client.connect();try{return (await client.query(sql)).rows;}finally{await client.end();}
}
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-update-'));
 const env={...process.env,OBSERVANDA_DATABASE_URL:'',OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};
 const runtime=await findPostgres(env);assert.ok(runtime,'A supported PostgreSQL runtime is needed');
 const oldRoot=path.join(directory,'original-application'),nextRoot=path.join(directory,'updated-application');
 for(const root of [oldRoot,nextRoot])await symlink(path.dirname(runtime.bin),root,process.platform==='win32'?'junction':'dir');
 const state=path.join(directory,'database'),config=path.join(state,'service.observanda');let service;
 t.after(async()=>{await service?.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 env.OBSERVANDA_POSTGRES_BIN=path.join(oldRoot,'bin');
 return {directory,env,oldRoot,nextRoot,state,config,runtime,
  async start(options={}){service=await startManagedPostgres({directory:state,env,...options});return service;},
  async close(){await service.close();service=null;}
 };
}

test('moving or repairing the application rebinds its compatible runtime without recreating the database',async t=>{
 const f=await fixture(t);await f.start();
 await query(f.env,'CREATE TABLE update_evidence(id integer PRIMARY KEY, body bytea)');
 await query(f.env,"INSERT INTO update_evidence VALUES(1,decode('00ff807f010203','hex'))");
 const identity=await query(f.env,'SELECT oid FROM pg_database WHERE datname=current_database()');
 await f.close();
 // The original executable path disappears, as it does after moving an app or
 // installing it into another directory. Its database stays in the user profile.
 await rename(f.oldRoot,path.join(f.directory,'retired-application'));
 f.env.OBSERVANDA_POSTGRES_BIN=path.join(f.nextRoot,'bin');
 const progress=[],service=await f.start({onProgress:p=>progress.push(p.stage)});
 assert.equal(service.bin,f.env.OBSERVANDA_POSTGRES_BIN);assert.ok(!progress.includes('initialize'));
 assert.deepEqual(await query(f.env,'SELECT oid FROM pg_database WHERE datname=current_database()'),identity);
 assert.deepEqual(await query(f.env,'SELECT id,body FROM update_evidence'),[{id:1,body:Buffer.from('00ff807f010203','hex')}]);
 await query(f.env,"INSERT INTO update_evidence VALUES(2,decode('fe','hex'))");await f.close();
 await f.start();assert.equal((await query(f.env,'SELECT count(*) FROM update_evidence'))[0].count,'2');
});

test('an update selects its explicit bundled runtime and resumes after cancellation without losing committed work',async t=>{
 const f=await fixture(t);await f.start();await query(f.env,'CREATE TABLE retained_update(value integer)');await query(f.env,'INSERT INTO retained_update VALUES(7)');await f.close();
 f.env.OBSERVANDA_POSTGRES_BIN=path.join(f.nextRoot,'bin');
 const controller=new AbortController();
 await assert.rejects(f.start({signal:controller.signal,onProgress:({stage})=>{if(stage==='start')controller.abort();}}),{code:'DATABASE_CANCELLED'});
 const service=await f.start();assert.equal(service.bin,f.env.OBSERVANDA_POSTGRES_BIN);
 assert.deepEqual(await query(f.env,'SELECT value FROM retained_update'),[{value:7}]);
});

test('incompatible cluster metadata is rejected before rebinding or starting its runtime',async t=>{
 const f=await fixture(t);await f.start();await f.close();
 const versionFile=path.join(f.state,'data','PG_VERSION'),version=await readFile(versionFile),config=await readFile(f.config);
 f.env.OBSERVANDA_POSTGRES_BIN=path.join(f.nextRoot,'bin');
 await writeFile(versionFile,'99\n');
 await assert.rejects(f.start(),{code:'DATABASE_RUNTIME'});
 assert.deepEqual(await readFile(f.config),config);assert.equal(f.env.OBSERVANDA_DATABASE_URL,undefined);
 await writeFile(versionFile,version);await f.start();
});
