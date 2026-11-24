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
