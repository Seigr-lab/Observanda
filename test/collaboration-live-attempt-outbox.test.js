import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collaborationFixture} from './fixtures/collaboration.js';
import {event} from './fixtures/attempts.js';
import {LiveConnections} from '../src/collaboration/live-connections.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {AppError} from '../src/errors.js';

test('structured outbox survives both lost acknowledgements, rejects replacement and retains unresolved access loss',async t=>{
 const f=await collaborationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());const card=await host.card(f.grant.id);
 let manager=new LiveConnections(f.member.workspace,f.member.deviceStore);t.after(()=>manager.close());
 const {id:connectionId}=await manager.command('connect',{card,verifiedFingerprint:card.identity.id}),recordId=f.book.entries[0].id,key={connectionId,recordId},item=event(null,{circumstances:'Recover this exact acquisition'}),command={recordId,id:item.id,kind:'event',item};
 const stageWrite=f.member.workspace.writeMetadata;f.member.workspace.writeMetadata=async function(file,text){if(file.includes('/attempt-outbox/'))throw new AppError('IO');return stageWrite.call(this,file,text);};
 try{await assert.rejects(manager.command('append-attempt',{connectionId,command}),{code:'IO'});}finally{f.member.workspace.writeMetadata=stageWrite;}
 assert.equal((await manager.command('attempt-pending',key)).pending,null);assert.equal((await manager.command('request',{connectionId,operation:'attempt',data:{recordId}})).attempt,null);
 let client=await manager.client(connectionId),call=client.call.bind(client);client.call=async(...args)=>{await call(...args);throw new AppError('LIVE_UNAVAILABLE');};
 await assert.rejects(manager.command('append-attempt',{connectionId,command}),{code:'LIVE_UNAVAILABLE'});
 assert.deepEqual((await manager.command('attempt-pending',key)).pending,{command});await assert.rejects(manager.command('attempt-acknowledge',{...key,id:item.id}),{code:'CONFLICT'});
 const different=event(null);await assert.rejects(manager.command('append-attempt',{connectionId,command:{recordId,id:different.id,kind:'event',item:different}}),{code:'CONFLICT'});
 const otherItem=event(null),otherKey={connectionId,recordId:f.book.entries[1].id},otherCommand={recordId:otherKey.recordId,id:otherItem.id,kind:'event',item:otherItem};
 await assert.rejects(manager.command('append-attempt',{connectionId,command:otherCommand}),{code:'LIVE_UNAVAILABLE'});assert.deepEqual((await manager.command('attempt-pending',otherKey)).pending,{command:otherCommand});
 await manager.close();manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 const [receipt,duplicate]=await Promise.all([manager.command('append-attempt',{connectionId,command}),manager.command('append-attempt',{connectionId,command})]);assert.deepEqual(receipt,duplicate);assert.equal(receipt.result.itemId,item.id);
 await manager.close();manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 assert.deepEqual((await manager.command('attempt-pending',key)).pending,receipt);assert.deepEqual(await manager.command('append-attempt',{connectionId,command}),receipt);
 assert.equal((await manager.command('request',{connectionId,operation:'attempt',data:{recordId}})).attempt.events.length,1);
 assert.equal((await manager.command('append-attempt',{connectionId,command:otherCommand})).result.itemId,otherItem.id);await manager.command('attempt-acknowledge',{...otherKey,id:otherItem.id});
 await manager.command('attempt-acknowledge',{...key,id:item.id});await manager.command('attempt-acknowledge',{...key,id:item.id});assert.equal((await manager.command('attempt-pending',key)).pending,null);
 const bad=event(null,{time:{meaning:'device-counter',value:''}}),rejected=await manager.command('append-attempt',{connectionId,command:{recordId,id:bad.id,kind:'event',item:bad}});assert.equal(rejected.rejected.code,'COLLABORATION_INVALID');
 await manager.command('attempt-acknowledge',{...key,id:bad.id});
 // A host may commit just before the local receipt write fails. The original
 // staged command is still enough to settle that result after a restart.
 const second=event(null,{circumstances:'Second acquisition'}),next={recordId,id:second.id,kind:'event',item:second},write=f.member.workspace.writeMetadata;
 f.member.workspace.writeMetadata=async function(file,text){if(file.includes('/attempt-outbox/')&&JSON.parse(text).result)throw new AppError('IO');return write.call(this,file,text);};
 try{await assert.rejects(manager.command('append-attempt',{connectionId,command:next}),{code:'IO'});}finally{f.member.workspace.writeMetadata=write;}
 assert.deepEqual((await manager.command('attempt-pending',key)).pending,{command:next});
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
 await assert.rejects(manager.command('append-attempt',{connectionId,command:next}),{code:'COLLABORATION_DENIED'});assert.deepEqual((await manager.command('attempt-pending',key)).pending,{command:next});
});
