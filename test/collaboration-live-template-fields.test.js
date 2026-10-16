import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {liveCreationFixture,creationCommand} from './fixtures/live-creation.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';

test('shared creation and editing retain a declared base and reject incompatible digits after the template changes',async t=>{
 const f=await liveCreationFixture(t);
 await f.author.workspace.update(book=>{book.notebooks.find(n=>n.id===f.book.notebooks[0].id).configuration.sections[0].fields[0].numeric={version:1,representation:'radix-fraction',radix:6};return book;});
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const a=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(()=>a.close());
 const options=await a.call('creation',{notebookId:f.book.notebooks[0].id});
 const create=creationCommand(options,{values:{counter:'-15.30',accepted:false}}),created=await a.call('create',create),recordId=created.record.id;
 const first=(await a.call('read',{recordId})).record;assert.deepEqual(first.template.fields[0].numeric,{version:1,representation:'radix-fraction',radix:6});assert.equal(first.template.values.counter,'-15.30');
 await f.author.workspace.update(book=>{book.notebooks.find(n=>n.id===f.book.notebooks[0].id).configuration.sections[0].fields[0].numeric.radix=8;return book;});
 const command=value=>({recordId,id:randomUUID(),changes:[{field:'template:counter',before:'-15.30',value}]});
 await assert.rejects(a.call('fields',command('6')));assert.equal((await a.call('read',{recordId})).record.template.values.counter,'-15.30');
 await a.call('fields',command('+15.3'));const updated=(await a.call('read',{recordId})).record;assert.equal(updated.template.values.counter,'+15.3');assert.equal(updated.template.fields[0].numeric.radix,6);
});

test('shared template edits merge by field, retain exact values and schemas, and reject stale/invalid batches atomically',async t=>{
 const f=await liveCreationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const card=await host.card(f.grant.id),a=new LiveClient(f.member.deviceStore,card),b=new LiveClient(f.member.deviceStore,card);t.after(()=>{a.close();b.close();});
 const options=await a.call('creation',{notebookId:f.book.notebooks[0].id}),created=await a.call('create',creationCommand(options)),recordId=created.record.id;
 const original=(await a.call('read',{recordId})).record,initial=await a.call('details',{recordId});assert.equal(initial.values['template:accepted'],false);assert.equal(initial.values['template:reviewDate'],null);assert.equal(initial.values['template:counter'],'9007199254740993.123456789');
 await f.author.workspace.update(book=>{book.notebooks.find(n=>n.id===original.notebookId).configuration.sections[0].fields[0].unit='cycles';return book;});
 const command=changes=>({recordId,id:randomUUID(),changes}),change=(field,before,value)=>({field,before,value});
 const counter=command([change('template:counter',initial.values['template:counter'],'9007199254740993.123456790')]);
 await Promise.all([a.call('fields',counter),b.call('fields',command([change('template:conditions','Dark chamber','Controlled light'),change('template:control',null,'Closed'),change('template:reviewDate',null,'2026-10-10')]))]);
 let current=await a.call('details',{recordId});assert.equal(current.values['template:counter'],'9007199254740993.123456790');assert.equal(current.values['template:conditions'],'Controlled light');assert.equal(current.values['template:control'],'Closed');assert.equal(current.values['template:reviewDate'],'2026-10-10');
 await assert.rejects(a.call('fields',command([change('template:accepted',false,true),change('template:counter',initial.values['template:counter'],'1')])) ,{code:'RECORD_CHANGED'});
 assert.deepEqual(await a.call('details',{recordId}),current);
 for(const item of [change('template:counter',current.values['template:counter'],123),change('template:counter',current.values['template:counter'],''),change('template:accepted',false,'true'),change('template:control','Closed','Not a choice'),change('template:reviewDate','2026-10-10','2026-02-30'),change('template:unknown',null,'injected'),change('template:__proto__',null,{polluted:true}),change('template',null,{fields:[]})])await assert.rejects(a.call('fields',command([change('title',current.values.title,'Must roll back'),item])));
 assert.deepEqual(await a.call('details',{recordId}),current);assert.equal({}.polluted,undefined);
 await b.call('fields',command([change('template:counter',current.values['template:counter'],'9999999999999999.000000001'),change('template:accepted',false,true)]));
 await a.call('fields',counter);current=await a.call('details',{recordId});assert.equal(current.values['template:counter'],'9999999999999999.000000001');assert.equal(current.values['template:accepted'],true);
 const saved=(await a.call('read',{recordId})).record;assert.deepEqual({...saved.template,values:{}},{...original.template,values:{}});assert.deepEqual(saved.body,original.body);assert.equal(saved.share,false);
 const activity=(await a.call('activity',{recordId})).items;assert.equal(activity.filter(item=>item.fields?.includes('template:counter')).length,2);
 const write=f.author.workspace.writeMetadata;f.author.workspace.writeMetadata=async function(file,value){if(file.includes('/live/activity/'))throw Error('Synthetic audit failure');return write.call(this,file,value);};
 try{await assert.rejects(a.call('fields',command([change('template:accepted',true,false)])));}finally{f.author.workspace.writeMetadata=write;}
 assert.deepEqual(await a.call('details',{recordId}),current);
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
 await assert.rejects(a.call('fields',counter),{code:'COLLABORATION_DENIED'});
});
