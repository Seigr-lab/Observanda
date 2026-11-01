import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {WorkspacePostgres} from '../src/workspace-postgres.js';

test('cancelled native startup keeps its copied key and serves the next authenticated request',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-native-startup-cancel-'));
 await mkdir(path.join(root,'.observanda'));
 const key=randomBytes(32),vault={id:randomUUID(),key:Buffer.from(key)},request=new AbortController(),lifetime=new AbortController();let initializations=0;
 const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN};delete env.OBSERVANDA_DATABASE_URL;
 const owner=new WorkspacePostgres({ownerId:randomUUID(),env,signal:lifetime.signal,onProgress:({stage})=>{
  if(stage==='initialize'){initializations++;request.abort();}
 }});
 t.after(async()=>{await owner.close();key.fill(0);vault.key.fill(0);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await assert.rejects(owner.open(root,vault,{create:true,signal:request.signal}),{name:'AbortError'});
 assert.equal(lifetime.signal.aborted,false);assert.equal(initializations,1);assert.equal(owner.instances.size,1);
 vault.key.fill(0);
 const next=await owner.open(root,{id:vault.id,key},{create:true});assert.equal(initializations,1);
 const client=new Client({connectionString:next.OBSERVANDA_DATABASE_URL});await client.connect();
 try{assert.equal((await client.query('SELECT 37 AS value')).rows[0].value,37);}finally{await client.end();}
 await owner.close();assert.equal(owner.instances.size,0);
});
