import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentKeyStore,AGENT_KEY_LIMIT,parseAgentKey} from '../src/security/agent-keys.js';

async function store(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-agent-keys-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 return new AgentKeyStore(path.join(directory,'device.json.agents'));
}
const workspaceId=randomUUID(),projectId=randomUUID(),labBookId=randomUUID();

test('a key is shown once, stored only as a hash and authenticates until revoked',async t=>{
 const keys=await store(t),now=new Date('2026-11-24T10:00:00.000Z');
 const {key,agentKey}=await keys.create({name:'Documentation agent',workspaceId,scope:{kind:'lab-book',projectId,labBookId},access:'write'},{now});
 assert.match(key,/^obsk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/);assert.equal(parseAgentKey(key).id,agentKey.id);
 assert.equal(agentKey.sha256,undefined);assert.deepEqual(agentKey.scope,{kind:'lab-book',projectId,labBookId});
 const stored=await readFile(path.join(keys.directory,agentKey.id+'.json'),'utf8');assert.equal(stored.includes(parseAgentKey(key).secret),false);
 const used=await keys.authenticate(key,{now});assert.equal(used.name,'Documentation agent');assert.equal(used.access,'write');
 assert.equal((await keys.list(workspaceId))[0].lastUsedAt,now.toISOString());assert.deepEqual(await keys.list(randomUUID()),[]);
 const wrong=key.slice(0,-1)+(key.endsWith('A')?'B':'A');
 for(const token of [wrong,'obsk_nope',key+'x','',null])await assert.rejects(keys.authenticate(token,{now}),{code:'AGENT_KEY_INVALID'});
 await assert.rejects(keys.revoke(randomUUID(),agentKey.id),{code:'NOT_FOUND'});
 assert.deepEqual(await keys.revoke(workspaceId,agentKey.id),{revoked:agentKey.id});
 await assert.rejects(keys.authenticate(key,{now}),{code:'AGENT_KEY_INVALID'});assert.deepEqual(await keys.list(workspaceId),[]);
});

test('expired keys, invalid requests, the key limit and newer key files are refused',async t=>{
 const keys=await store(t),now=new Date('2026-11-24T10:00:00.000Z');
 const {key}=await keys.create({name:'Short lived',workspaceId,scope:{kind:'workspace'},access:'read',expiresAt:'2026-11-24T11:00:00.000Z'},{now});
 assert.equal((await keys.authenticate(key,{now})).access,'read');
 await assert.rejects(keys.authenticate(key,{now:new Date('2026-11-24T11:00:00.000Z')}),{code:'AGENT_KEY_INVALID'});
 for(const request of [
  {name:'',workspaceId,scope:{kind:'workspace'},access:'read'},{name:'x'.repeat(81),workspaceId,scope:{kind:'workspace'},access:'read'},
  {name:'Agent',workspaceId,scope:{kind:'project'},access:'read'},{name:'Agent',workspaceId,scope:{kind:'workspace'},access:'admin'},
  {name:'Agent',workspaceId,scope:{kind:'workspace'},access:'read',expiresAt:'2026-11-24T09:00:00.000Z'}
 ])await assert.rejects(keys.create(request,{now}),{code:'INVALID'});
 for(let i=(await readdir(keys.directory)).filter(name=>name.endsWith('.json')).length;i<AGENT_KEY_LIMIT;i++)await keys.create({name:'Agent '+i,workspaceId,scope:{kind:'workspace'},access:'read'},{now});
 await assert.rejects(keys.create({name:'One too many',workspaceId,scope:{kind:'workspace'},access:'read'},{now}),{code:'AGENT_KEY_LIMIT'});
 const [first]=await keys.list(workspaceId),file=path.join(keys.directory,first.id+'.json'),value=JSON.parse(await readFile(file,'utf8'));
 await writeFile(file,JSON.stringify({...value,format:2}));await assert.rejects(keys.list(workspaceId),{code:'STORAGE_NEWER'});
 await writeFile(file,JSON.stringify({...value,extra:true}));await assert.rejects(keys.list(workspaceId),{code:'AGENT_KEY_DAMAGED'});
});

test('the running app publishes its agent address for the CLI and withdraws only its own',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-agent-endpoint-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const preferences=path.join(directory,'preferences.json'),keys=new AgentKeyStore(preferences+'.device-key.agents');
 const {execFile}=await import('node:child_process'),run=()=>new Promise(resolve=>execFile(process.execPath,['src/cli.js','api','--preferences',preferences],(error,stdout)=>resolve({code:error?.code??0,value:JSON.parse(stdout)})));
 let printed=await run();assert.equal(printed.code,1);assert.equal(printed.value.error.code,'AGENT_APP_CLOSED');
 await keys.publishEndpoint('http://127.0.0.1:41234','1.0.0',{now:new Date('2026-11-24T10:00:00.000Z')});
 printed=await run();assert.equal(printed.code,0);
 assert.deepEqual(printed.value,{version:1,ok:true,result:{origin:'http://127.0.0.1:41234',description:'http://127.0.0.1:41234/api/v1/openapi.json',apiVersion:'1.0.0',startedAt:'2026-11-24T10:00:00.000Z'}});
 await keys.withdrawEndpoint('http://127.0.0.1:50000');assert.equal((await keys.endpoint()).origin,'http://127.0.0.1:41234');
 await keys.withdrawEndpoint('http://127.0.0.1:41234');assert.equal(await keys.endpoint(),null);
 await writeFile(keys.endpointFile(),JSON.stringify({format:1,origin:'https://example.org'}));await assert.rejects(keys.endpoint(),{code:'AGENT_KEY_DAMAGED'});
});

test('agent changes are kept per workspace, newest first, and a damaged log is refused',async t=>{
 const keys=await store(t),other=randomUUID(),now=new Date('2026-11-24T10:00:00.000Z');
 const {agentKey}=await keys.create({name:'Release agent',workspaceId,scope:{kind:'workspace'},access:'write'},{now});
 const entry=(recordId,operation,minute)=>keys.recordActivity({key:agentKey,operation,projectId,labBookId,recordId,title:'Release 1.2'},{now:new Date(Date.UTC(2026,10,24,10,minute))});
 const first=randomUUID();await entry(first,'records/create',1);await entry(first,'records/update',2);
 await keys.recordActivity({key:{...agentKey,workspaceId:other},operation:'records/create',projectId,labBookId,recordId:randomUUID(),title:'Elsewhere'},{now});
 assert.deepEqual((await keys.activity(workspaceId)).map(value=>[value.operation,value.at,value.keyName]),[['records/update','2026-11-24T10:02:00.000Z','Release agent'],['records/create','2026-11-24T10:01:00.000Z','Release agent']]);
 assert.deepEqual((await keys.activity(other)).map(value=>value.title),['Elsewhere']);
 await assert.rejects(keys.recordActivity({key:agentKey,operation:'records/remove',projectId,labBookId,recordId:first,title:'x'},{now}),{code:'INVALID'});
 await writeFile(keys.activityFile(),'{"format":1}\n');await assert.rejects(keys.activity(workspaceId),{code:'AGENT_KEY_DAMAGED'});
});
