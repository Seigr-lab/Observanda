import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {schema} from '../src/editor/schema.js';
import {EditorState} from 'prosemirror-state';
import {collab,sendableSteps,receiveTransaction,getVersion} from 'prosemirror-collab';
import {Step} from 'prosemirror-transform';
import {onlineStepBatch} from '../src/web/online-step-batch.js';

test('TLS peers edit shared text simultaneously, retry safely, preserve local changes and enforce revocation',async t=>{
 const f=await collaborationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const card=await host.card(f.grant.id),clients=[new LiveClient(f.member.deviceStore,card),new LiveClient(f.member.deviceStore,card)];t.after(()=>clients.forEach(c=>c.close()));const [a,b]=clients;
 const listing=await a.call('list');assert.equal(listing.records.length,2);assert.ok(!JSON.stringify(listing).includes('Unrelated private'));
 await assert.rejects(a.call('read',{recordId:f.book.entries[2].id}),{code:'COLLABORATION_DENIED'});
 const recordId=f.book.entries[0].id,clientIds=[randomUUID(),randomUUID()],initial=await a.call('document',{recordId,field:'body',clientId:clientIds[0]});
 let states=clientIds.map(clientID=>EditorState.create({schema,doc:schema.nodeFromJSON(initial.document),plugins:[collab({version:initial.version,clientID})]}));
 states[0]=states[0].apply(states[0].tr.insertText('Alice ',1));states[1]=states[1].apply(states[1].tr.insertText('Bob ',1));
 const send=async(i)=>{const pending=sendableSteps(states[i]);const result=await clients[i].call(pending?'steps':'document',{recordId,field:'body',clientId:clientIds[i],epoch:initial.epoch,version:getVersion(states[i]),...(pending?{steps:pending.steps.map(s=>s.toJSON())}:{})});assert.equal(result.reset,false);states[i]=states[i].apply(receiveTransaction(states[i],result.steps.map(s=>Step.fromJSON(schema,s)),result.clients));return result;};
 await send(0);await send(1);assert.ok(sendableSteps(states[1]));await send(1);await send(0);assert.ok(states[0].doc.eq(states[1].doc));assert.match(states[0].doc.textContent,/Alice/);assert.match(states[0].doc.textContent,/Bob/);
 const saved=(await a.call('read',{recordId})).record;assert.ok(schema.nodeFromJSON(saved.body).eq(states[0].doc));
 // A long offline session is acknowledged in prefixes. A lost response to
 // the first batch must neither duplicate that text nor drop the remainder.
 for(let i=0;i<701;i++)states[0]=states[0].apply(states[0].tr.insertText('ø',1));
 const packet=()=>({recordId,field:'body',clientId:clientIds[0],epoch:initial.epoch,version:getVersion(states[0]),steps:onlineStepBatch(sendableSteps(states[0]).steps.map(s=>s.toJSON()))});
 const first=packet();assert.equal(first.steps.length,250);await a.call('steps',first);const retry=await a.call('steps',first);states[0]=states[0].apply(receiveTransaction(states[0],retry.steps.map(s=>Step.fromJSON(schema,s)),retry.clients));
 let batches=1;while(sendableSteps(states[0])){const response=await a.call('steps',packet());states[0]=states[0].apply(receiveTransaction(states[0],response.steps.map(s=>Step.fromJSON(schema,s)),response.clients));batches++;}
 assert.equal(batches,3);await send(1);assert.ok(states[0].doc.eq(states[1].doc));assert.equal((states[0].doc.textContent.match(/ø/g)??[]).length,701);
 // Same id and payload survives a lost response; it cannot authorize new data.
 const command={recordId,id:randomUUID(),changes:[{field:'title',before:saved.title,value:'Shared result'}]};await a.call('fields',command);await a.call('fields',command);await assert.rejects(a.call('fields',{...command,changes:[{...command.changes[0],value:'Replay attack'}]}),{code:'CONFLICT'});
 await assert.rejects(b.call('fields',{...command,id:randomUUID()}),{code:'RECORD_CHANGED'});
 const comment={recordId,id:randomUUID(),text:'Check these observations'};await a.call('comment',comment);await a.call('comment',comment);assert.equal((await b.call('comments',{recordId})).items.length,1);
 const latest=(await a.call('read',{recordId})).record;await new ResearchRecords(f.author.workspace,{}).save({workspaceId:f.book.id,changes:[{id:recordId,expectedRevision:recordRevision(latest),record:{...latest,body:'Ordinary editor changed this'}}]});
 const reset=await a.call('document',{recordId,field:'body',clientId:clientIds[0],version:getVersion(states[0]),epoch:initial.epoch});assert.equal(reset.reset,true);assert.notEqual(reset.epoch,initial.epoch);
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,active:false});
 for(const op of ['list','read','document','comment'])await assert.rejects(a.call(op,{recordId,field:'body',clientId:clientIds[0],...comment}),{code:'COLLABORATION_DENIED'});
});
