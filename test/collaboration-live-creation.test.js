import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {liveCreationFixture,creationCommand} from './fixtures/live-creation.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {LiveConnections} from '../src/collaboration/live-connections.js';
import {ResearchRecords} from '../src/research.js';
import {AppError} from '../src/errors.js';

async function setup(t){
 const f=await liveCreationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const card=await host.card(f.grant.id),client=new LiveClient(f.member.deviceStore,card);t.after(()=>client.close());
 const options=await client.call('creation',{notebookId:f.book.notebooks[0].id});return {...f,host,card,client,options};
}
test('shared creation retains the host template, exact values and audit; concurrent retries create once and never replace later work',async t=>{
 const f=await setup(t),command=creationCommand(f.options),[a,b]=await Promise.all([f.client.call('create',command),f.client.call('create',command)]);
 assert.deepEqual(a,b);assert.equal(a.removed,false);const recordId=a.record.id;
 let read=await f.client.call('read',{recordId});assert.equal(read.record.share,false);assert.equal(read.record.status,'draft');assert.equal(read.record.type,'note');assert.equal(read.record.template.id,f.templateId);assert.deepEqual(read.record.template.values,command.values);assert.equal(read.revision,a.record.revision);
 await f.client.call('fields',{recordId,id:randomUUID(),changes:[{field:'title',before:command.title,value:'Continued work'}]});
 assert.deepEqual(await f.client.call('create',command),a);read=await f.client.call('read',{recordId});assert.equal(read.record.title,'Continued work');
 const activity=await f.client.call('activity',{recordId});assert.equal(activity.items.filter(i=>i.operation==='create').length,1);assert.equal(activity.items.find(i=>i.operation==='create').principalId,f.principalId);
 await assert.rejects(f.client.call('create',{...command,title:'Different request'}),{code:'CONFLICT'});
 const base=f.options.choices.find(c=>c.id==='experiment'),native=await f.client.call('create',creationCommand(f.options,{id:randomUUID(),source:{kind:base.kind,id:base.id,revision:base.revision},values:{}}));
 const nativeRecord=(await f.client.call('read',{recordId:native.record.id})).record;assert.equal(nativeRecord.type,'experiment');assert.deepEqual(nativeRecord.sections.map(s=>s.title),base.sections);assert.equal(new Set(nativeRecord.sections.map(s=>s.id)).size,base.sections.length);
 await f.author.workspace.update(book=>{book.entries.find(e=>e.id===native.record.id).notebookId=f.book.notebooks.at(-1).id;return book;});
 // A previously successful request cannot be used to follow a record into a private book.
 await assert.rejects(f.client.call('read',{recordId:native.record.id}),{code:'COLLABORATION_DENIED'});
 await new ResearchRecords(f.author.workspace,{}).remove({workspaceId:f.book.id,recordId,expectedRevision:read.revision});
 assert.equal((await f.client.call('create',command)).removed,true);assert.ok(!(await f.client.call('list')).records.some(r=>r.id===recordId));
});

test('creation rejects foreign books, stale templates, invalid values and injected fields; receipts and audits roll back with records',async t=>{
 const f=await setup(t),command=creationCommand(f.options),initial=(await f.client.call('list')).records.length;
 await assert.rejects(f.client.call('creation',{notebookId:f.book.notebooks.at(-1).id}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(f.client.call('create',{...command,notebookId:f.book.notebooks.at(-1).id}),{code:'COLLABORATION_DENIED'});
 for(const change of [{share:true},{title:' '},{occurredOn:'2026-02-30'},{values:{}},{values:{...command.values,counter:9007199254740992}},{values:{...command.values,unknown:'x'}},{source:{...command.source,revision:'0'.repeat(64)}}])await assert.rejects(f.client.call('create',{...command,...change}));
 for(const target of ['/live/creations/','/live/activity/']){
  const write=f.author.workspace.writeMetadata;f.author.workspace.writeMetadata=async function(file,value){if(file.includes(target))throw Error('Synthetic failure');return write.call(this,file,value);};
  try{await assert.rejects(f.client.call('create',command));}finally{f.author.workspace.writeMetadata=write;}
  assert.equal((await f.client.call('list')).records.length,initial);
 }
 await f.author.workspace.update(book=>{book.notebooks.find(n=>n.id===command.notebookId).configuration.sections[0].description='Updated procedure';return book;});
 await assert.rejects(f.client.call('create',command),{code:'RECORD_CHANGED'});
 const fresh=creationCommand(await f.client.call('creation',{notebookId:command.notebookId}));await f.client.call('create',fresh);
 await f.author.workspace.update(book=>{book.notebooks.find(n=>n.id===command.notebookId).configuration.sections[0].enabled=false;return book;});
 assert.ok(!(await f.client.call('creation',{notebookId:command.notebookId})).choices.some(c=>c.id===f.templateId));
 assert.equal((await f.client.call('create',fresh)).removed,false);
 const {generation,...grant}=f.grant;void generation;
 await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
 await assert.rejects(f.client.call('create',fresh),{code:'COLLABORATION_DENIED'});await assert.rejects(f.client.call('creation',{notebookId:command.notebookId}),{code:'COLLABORATION_DENIED'});
});

test('encrypted creation outbox survives a lost host response, restart and local response loss without duplicates',async t=>{
 const f=await setup(t);let manager=new LiveConnections(f.member.workspace,f.member.deviceStore);t.after(()=>manager.close());
 const {id:connectionId}=await manager.command('connect',{card:f.card,verifiedFingerprint:f.card.identity.id}),command=creationCommand(f.options),client=await manager.client(connectionId),call=client.call.bind(client);
 client.call=async(...args)=>{await call(...args);throw new AppError('LIVE_UNAVAILABLE');};
 await assert.rejects(manager.command('create-record',{connectionId,command}),{code:'LIVE_UNAVAILABLE'});
 assert.deepEqual((await manager.command('creation-pending',{connectionId})).pending.command,command);
 await assert.rejects(manager.command('creation-acknowledge',{connectionId,id:command.id}),{code:'CONFLICT'});
 await manager.close();manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 const receipt=await manager.command('create-record',{connectionId,command});assert.ok(receipt.result.record.id);
 await manager.close();manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 assert.deepEqual((await manager.command('creation-pending',{connectionId})).pending,receipt);
 assert.deepEqual(await manager.command('create-record',{connectionId,command}),receipt);
 await assert.rejects(manager.command('create-record',{connectionId,command:{...command,id:randomUUID()}}),{code:'CONFLICT'});
 assert.equal((await f.client.call('list')).records.filter(r=>r.title===command.title).length,1);
 await manager.command('creation-acknowledge',{connectionId,id:command.id});assert.equal((await manager.command('creation-pending',{connectionId})).pending,null);
 const bad={...command,id:randomUUID(),values:{}};const rejected=await manager.command('create-record',{connectionId,command:bad});assert.equal(rejected.rejected.code,'INVALID');
 await manager.command('creation-acknowledge',{connectionId,id:bad.id});
});
