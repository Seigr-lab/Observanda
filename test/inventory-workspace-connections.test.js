import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InventoryWorkspaceConnections} from '../src/inventory-workspace-connections.js';
import {AppError} from '../src/errors.js';

const id=value=>'00000000-0000-4000-a000-'+String(value).padStart(12,'0');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

// Grant storage is in memory. Its current() contract matches the target owner's
// client, expiry and replacement checks without opening files or a database.
function fixture(){
 const application={},connections=new InventoryWorkspaceConnections(application),entries=new Map(),released=[],disposed=[],visited=[];
 let next=0;
 const targets={
  entries,
  expire(){for(const [key,entry] of entries)if(entry.expires<=Date.now()&&!entry.active){entries.delete(key);disposed.push(key);}},
  async list(){return {workspaces:[]};},
  async use(client,key,consume,{check=async()=>{}}={}){
   const entry=entries.get(key);if(!entry||entry.client!==client)throw new AppError('PROJECT_MOVE_DESTINATION_ACCESS');
   const current=async()=>{await check();if(entries.get(key)!==entry||entry.expires<=Date.now()||entry.failure)throw entry.failure??new AppError('PROJECT_MOVE_DESTINATION_ACCESS');};
   entry.active++;visited.push(key);try{await current();return await consume(entry,current);}finally{entry.active--;}
  },
  async release(client,key){const entry=entries.get(key);assert.equal(entry?.client,client);assert.equal(entry.active,0);entries.delete(key);released.push(key);},
  async open(client,input,{check=async()=>{}}={}){await check();const entry=add(client,input.sourceNamespace,'reopened');return {id:entry.key,workspaceId:entry.registry.workspaceId,title:'Reopened source'};},
  async close(){entries.clear();}
 };
 function add(client,workspaceId,label='source',failure=null){
  const key=(++next).toString(16).padStart(48,'0'),entry={key,client,registry:{workspaceId},application:{workspace:{root:label}},expires:Date.now()+60000,active:0,failure};entries.set(key,entry);return entry;
 }
 connections.targets=targets;return {connections,entries,add,released,disposed,visited};
}
const selected=(namespace,projectId=id(30))=>({workspaceId:namespace,projectId,labBookId:null});

test('unrelated revoked workspace grants do not prevent discovery of a healthy source',async()=>{
 for(const code of ['PROJECT_MOVE_DESTINATION_ACCESS','ACCESS_LOCKED','ENOENT','STORAGE_MOVE_STATE'])for(const first of [true,false]){
  const f=fixture(),client={},source=id(10),healthy=id(2);
  const addRevoked=()=>f.add(client,id(1),'unrelated',Object.assign(new Error('Unavailable source'),{code}));
  if(first)addRevoked();f.add(client,healthy);if(!first)addRevoked();
  const result=await f.connections.locate(client,source,async registry=>{assert.equal(registry.workspaceId,healthy);return selected(source);});
  assert.equal(result.sourceWorkspaceId,healthy);assert.deepEqual(result.owner,selected(source));await result.check();
 }
});

test('source discovery skips missing or moved namespaces but propagates damaged owners and request revocation',async()=>{
 for(const code of ['NOT_FOUND','PROJECT_MOVED']){
  const f=fixture(),client={},namespace=id(10);f.add(client,id(1));f.add(client,id(2));
  const value=await f.connections.locate(client,namespace,async registry=>{if(registry.workspaceId===id(1))throw new AppError(code);return selected(namespace);});assert.equal(value.sourceWorkspaceId,id(2));
 }
 for(const code of ['CATALOGUE_DAMAGED','IO']){
  const f=fixture(),client={};f.add(client,id(1),'damaged',new AppError(code));f.add(client,id(2));
  await assert.rejects(f.connections.locate(client,id(10),async()=>selected(id(10))),{code});
 }
 for(const initiallyRevoked of [true,false]){
  const f=fixture(),client={};f.add(client,id(1));let revoked=initiallyRevoked,reads=0;
  await assert.rejects(f.connections.locate(client,id(10),async()=>{reads++;revoked=true;return selected(id(10));},{check:async()=>{if(revoked)throw new AppError('ACCESS_LOCKED');}}),{code:'ACCESS_LOCKED'});assert.equal(reads,initiallyRevoked?0:1);
 }
 const empty=fixture();await assert.rejects(empty.connections.locate({},id(10),()=>assert.fail('No source exists'),{check:async()=>{throw new AppError('ACCESS_LOCKED');}}),{code:'ACCESS_LOCKED'});
});

test('a previously selected source keeps its original revoked grant check',async()=>{
 const f=fixture(),client={},entry=f.add(client,id(1)),namespace=id(10),value=await f.connections.locate(client,namespace,async()=>selected(namespace));
 entry.failure=new AppError('PROJECT_MOVE_DESTINATION_ACCESS');
 await assert.rejects(value.check(),error=>error.code==='INVENTORY_SOURCE_WORKSPACE'&&error.sourceWorkspaceId===id(1));
});

test('reconnecting replaces future access while revoking an active old grant without borrowing another client grant',async()=>{
 const f=fixture(),client={},other={},workspace=id(1),old=f.add(client,workspace,'old'),otherEntry=f.add(other,workspace,'other'),inactive=f.add(client,workspace,'inactive');
 // The active operation begins on the most recent old grant.
 f.entries.delete(old.key);f.entries.set(old.key,old);
 const entered=deferred(),continueOld=deferred();let oldCheck;
 const running=f.connections.use(client,workspace,async(entry,current)=>{assert.equal(entry,old);oldCheck=current;entered.resolve();await continueOld.promise;await current();});
 const rejected=assert.rejects(running,{code:'INVENTORY_SOURCE_WORKSPACE'});
 await entered.promise;
 const opened=await f.connections.request(client,'open',{workspaceId:id(9),sourceNamespace:workspace});assert.equal(opened.sourceWorkspaceId,workspace);
 assert.ok(old.expires<=Date.now());assert.ok(otherEntry.expires>Date.now());assert.ok(f.released.includes(inactive.key));assert.ok(!f.released.includes(old.key));
 await assert.rejects(oldCheck(),error=>error.code==='INVENTORY_SOURCE_WORKSPACE'&&error.sourceWorkspaceId===workspace);
 const replacement=await f.connections.use(client,workspace,entry=>entry);assert.equal(replacement.application.workspace.root,'reopened');assert.notEqual(replacement,old);
 assert.equal(await f.connections.use(other,workspace,entry=>entry),otherEntry);
 continueOld.resolve();await rejected;f.connections.expire();assert.ok(f.disposed.includes(old.key));assert.equal(f.entries.has(replacement.key),true);
});

test('client isolation applies to lookup, unknown sources, and connection listings',async()=>{
 const f=fixture(),client={},other={},workspace=id(1),entry=f.add(other,workspace);let reads=0;
 assert.equal(await f.connections.locate(client,id(10),async()=>{reads++;return selected(id(10));}),null);assert.equal(reads,0);
 await assert.rejects(f.connections.use(client,workspace,()=>assert.fail('Foreign grant was used')),error=>error.code==='INVENTORY_SOURCE_WORKSPACE'&&error.sourceWorkspaceId===workspace);
 assert.deepEqual((await f.connections.request(client,'list',{workspaceId:id(9)})).connections,[]);
 assert.equal(await f.connections.use(other,workspace,value=>value),entry);
 assert.equal(await f.connections.locate(other,id(10),async()=>{throw new AppError('NOT_FOUND');}),null);
});

test('two authorized connections claiming the same namespace are rejected as ambiguous',async()=>{
 const f=fixture(),client={},namespace=id(10);f.add(client,id(1));f.add(client,id(2));
 await assert.rejects(f.connections.locate(client,namespace,async registry=>selected(namespace,registry.workspaceId)),{code:'INVENTORY_SOURCE_AMBIGUOUS'});
});

test('late source-open cleanup cannot disconnect a replacement grant or another client',async()=>{
 const f=fixture(),client={},other={},workspaceId=id(9),sourceWorkspaceId=id(1);
 const first=await f.connections.request(client,'open',{workspaceId,sourceNamespace:sourceWorkspaceId});
 const second=await f.connections.request(client,'open',{workspaceId,sourceNamespace:sourceWorkspaceId});
 assert.notEqual(first.connectionId,second.connectionId);
 assert.deepEqual(await f.connections.request(client,'close',{workspaceId,sourceWorkspaceId,connectionId:first.connectionId}),{workspaceId,closed:true});
 assert.equal((await f.connections.use(client,sourceWorkspaceId,entry=>entry)).key,second.connectionId);
 await assert.rejects(f.connections.request(other,'close',{workspaceId,sourceWorkspaceId,connectionId:second.connectionId}),{code:'INVALID'});
 await assert.rejects(f.connections.request(client,'close',{workspaceId,sourceWorkspaceId:id(2),connectionId:second.connectionId}),{code:'INVALID'});
 await assert.rejects(f.connections.request(client,'close',{workspaceId,sourceWorkspaceId,connectionId:'invalid'}),{code:'INVALID'});
 await f.connections.request(client,'close',{workspaceId,sourceWorkspaceId,connectionId:second.connectionId});
 await assert.rejects(f.connections.use(client,sourceWorkspaceId,()=>assert.fail('Closed grant reused')),{code:'INVENTORY_SOURCE_WORKSPACE'});
});
