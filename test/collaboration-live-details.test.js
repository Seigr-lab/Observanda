import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';

test('shared details merge independent fields, reject stale compound changes atomically and honor current grants on retries',async t=>{
 const f=await collaborationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const card=await host.card(f.grant.id),a=new LiveClient(f.member.deviceStore,card),b=new LiveClient(f.member.deviceStore,card);t.after(()=>{a.close();b.close();});
 const recordId=f.book.entries[0].id,initial=await a.call('details',{recordId});
 assert.deepEqual(Object.keys(initial.values).sort(),['outcome','status','tags','title']);assert.equal(initial.values.outcome,null);assert.equal(initial.role,'editor');assert.ok(!JSON.stringify(initial).includes('body'));
 const command=changes=>({recordId,id:randomUUID(),changes}),change=(field,before,value)=>({field,before,value});
 const title=command([change('title',initial.values.title,'Shared title')]),progress=command([change('status',initial.values.status,'in progress')]);
 await Promise.all([a.call('fields',title),b.call('fields',progress)]);
 let current=await a.call('details',{recordId});assert.equal(current.values.title,'Shared title');assert.equal(current.values.status,'in progress');
 const compound=command([change('outcome',null,'Must not be partially written'),change('title',initial.values.title,'Stale overwrite')]);
 await assert.rejects(a.call('fields',compound),{code:'RECORD_CHANGED'});assert.deepEqual(await a.call('details',{recordId}),current);
 for(const changes of [[change('title','Shared title','x'.repeat(181))],[change('status','in progress','unrecognized')],[change('tags',current.values.tags,Array.from({length:13},(_,i)=>String(i)))],[change('share',false,true)]])await assert.rejects(a.call('fields',command(changes)));
 assert.deepEqual(await a.call('details',{recordId}),current);
 const final=command([change('outcome',null,'Negative result'),change('tags',current.values.tags,['reviewed','field'])]);
 const receipt=await a.call('fields',final);assert.deepEqual(await a.call('fields',final),receipt);
 await b.call('fields',command([change('outcome','Negative result','Inconclusive after review')]));await a.call('fields',final);
 current=await a.call('details',{recordId});assert.equal(current.values.outcome,'Inconclusive after review');assert.deepEqual(current.values.tags,['reviewed','field']);
 const history=await a.call('activity',{recordId});assert.equal(history.items.filter(i=>i.fields?.includes('tags')).length,1);
 // A failed audit write cannot leave any part of a multi-field mutation saved.
 const write=f.author.workspace.writeMetadata;
 f.author.workspace.writeMetadata=async function(file,value){if(file.includes('/live/activity/'))throw Error('Synthetic audit failure');return write.call(this,file,value);};
 try{await assert.rejects(a.call('fields',command([change('title','Shared title','Not saved'),change('status','in progress','completed')])));}finally{f.author.workspace.writeMetadata=write;}
 assert.deepEqual(await a.call('details',{recordId}),current);
 await assert.rejects(a.call('details',{recordId:f.book.entries[2].id}),{code:'COLLABORATION_DENIED'});
 const {generation,...grant}=f.grant;void generation;
 await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
 assert.equal((await a.call('details',{recordId})).role,'reader');await assert.rejects(a.call('fields',final),{code:'COLLABORATION_DENIED'});
 await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:2,active:false});
 await assert.rejects(a.call('details',{recordId}),{code:'COLLABORATION_DENIED'});
});
