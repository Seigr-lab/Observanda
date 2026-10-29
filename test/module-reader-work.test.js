import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ModuleReader} from '../src/modules/reader.js';
import {projectModuleFederation} from '../src/project-module-federation.js';
import {AppError} from '../src/errors.js';

function fixture(size=10000){
 const workspaceId=randomUUID(),rows=Array.from({length:size},(_,i)=>({id:randomUUID(),type:'resource',title:'Item '+String(i).padStart(6,'0'),createdAt:'2026-01-01T00:00:00.000Z',status:'available'})),byId=new Map(rows.map(row=>[row.id,row])),calls={members:0,member:0,view:0};
 const context={book:{id:workspaceId},head:{revision:1},
  async *members(options){calls.members++;calls.options=options;yield* rows;},
  async member(id){calls.member++;return byId.get(id)??null;},async view(member){calls.view++;return member;},
  async constraint(member){return {type:member.type,data:{kind:'material'}};},async search(member){return member.title.toLowerCase();},
  encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))};
 const reader=new ModuleReader({root:'.'},{context:async(_id,operation)=>operation(context)});
 return {workspaceId,rows,byId,calls,context,reader};
}

test('exact module selections never traverse unrelated members and preserve pagination',async()=>{
 const f=fixture(),query={workspaceId:f.workspaceId,type:'resource',key:f.rows[9999].id};
 const one=await f.reader.list(query);assert.deepEqual(one.items,[f.rows[9999]]);assert.equal(one.total,1);assert.deepEqual({members:f.calls.members,member:f.calls.member,view:f.calls.view},{members:0,member:1,view:1});
 const keys=f.rows.slice(0,60).reverse().map(row=>row.id),selected={workspaceId:f.workspaceId,type:'resource',keys,limit:25};
 const first=await f.reader.list(selected),second=await f.reader.list({...selected,cursor:first.nextCursor}),last=await f.reader.list({...selected,cursor:second.nextCursor});
 assert.deepEqual([...first.items,...second.items,...last.items],f.rows.slice(0,60));assert.equal(last.nextCursor,null);assert.equal(last.total,60);
 assert.deepEqual((await f.reader.list({...selected,cursor:second.previousCursor})).items,first.items);assert.equal(f.calls.members,0);assert.equal(f.calls.view,f.calls.member);
 f.context.head.revision++;await assert.rejects(f.reader.list({...selected,cursor:first.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
});

test('selected module IDs retain missing, type, intersection and filter semantics',async()=>{
 const f=fixture(4),base={workspaceId:f.workspaceId,type:'resource'},id=f.rows[0].id,missing=randomUUID();
 assert.equal((await f.reader.list({...base,key:missing})).total,0);
 assert.equal((await f.reader.list({...base,keys:[]})).total,0);
 assert.equal((await f.reader.list({...base,keys:[id],key:f.rows[1].id})).total,0);
 assert.equal((await f.reader.list({...base,keys:[id],query:'absent'})).total,0);
 assert.equal((await f.reader.list({...base,keys:[id],status:'unavailable'})).total,0);
 assert.equal((await f.reader.list({...base,keys:[id],kind:'equipment'})).total,0);
 assert.equal((await f.reader.list({...base,keys:[id],moduleId:'resources',scopeIds:[]})).total,0);
 assert.equal((await f.reader.list({...base,keys:[id],moduleId:'resources',scopeIds:[null]})).total,1);
 await assert.rejects(f.reader.list({...base,keys:[id,missing],query:'absent'}),{code:'NOT_FOUND'});
 f.rows[0].type='task';await assert.rejects(f.reader.list({...base,keys:[id]}),{code:'NOT_FOUND'});assert.equal((await f.reader.list({...base,key:id})).total,0);
 assert.equal(f.calls.members,0);
 f.context.member=async()=>{throw new AppError('MODULE_REFERENCE');};assert.equal((await f.reader.list({...base,key:id})).total,0);
 await assert.rejects(f.reader.list({...base,keys:[id]}),{code:'MODULE_REFERENCE'});
 f.context.member=async()=>{throw new AppError('CATALOGUE_DAMAGED');};await assert.rejects(f.reader.list({...base,key:id}),{code:'CATALOGUE_DAMAGED'});
});

test('module candidate traversal forwards type selection and cancellation',async()=>{
 const f=fixture(2),controller=new AbortController();await f.reader.list({workspaceId:f.workspaceId,types:['resource']},{signal:controller.signal});
 assert.deepEqual(f.calls.options.types,['resource']);assert.equal(f.calls.options.signal,controller.signal);
 const reason=Error('stop selection');f.context.member=async()=>{controller.abort(reason);return f.rows[0];};
 await assert.rejects(f.reader.list({workspaceId:f.workspaceId,type:'resource',keys:f.rows.map(row=>row.id)},{signal:controller.signal}),error=>error===reason);
});

test('module federation traverses only requested owner domains and propagates cancellation',async()=>{
 const controller=new AbortController(),visited=[],owners=new Map(['inventory','tasks'].map(domain=>[domain,{head:{revision:0},catalogue:{async *members(_head,{signal}){assert.equal(signal,controller.signal);visited.push(domain);signal?.throwIfAborted();yield domain;}}}]));
 const federation=await projectModuleFederation({registry:{namespaceId:randomUUID()},owner:async domain=>owners.get(domain)},[...owners.keys()]);
 assert.deepEqual(await Array.fromAsync(federation.members(federation.head,{types:['resource'],signal:controller.signal})),['inventory']);assert.deepEqual(visited,['inventory']);
 controller.abort();await assert.rejects(Array.fromAsync(federation.members(federation.head,{signal:controller.signal})),{name:'AbortError'});
});
