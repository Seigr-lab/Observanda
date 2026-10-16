import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {LiveConnections} from '../src/collaboration/live-connections.js';
import {LiveDrafts} from '../src/collaboration/live-drafts.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {proseDocument} from '../src/web/prose-model.js';

test('local drafts survive removed connections and restart; verified renewed cards recover the same connection',async t=>{
 const f=await collaborationFixture(t);let host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0}),manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 t.after(async()=>{await manager.close();await host.close();});
 const card=await host.card(f.grant.id),{id}=await manager.command('connect',{card,verifiedFingerprint:card.identity.id}),ref={connectionId:id,recordId:f.book.entries[0].id,field:'body',clientId:randomUUID()};
 const saved=await manager.command('draft',{...ref,title:'A result',fieldTitle:'Summary',document:proseDocument('An offline observation')});
 await manager.command('disconnect',{connectionId:id});assert.equal((await manager.command('state')).connections.length,0);await assert.rejects(manager.command('request',{connectionId:id,operation:'list'}),{code:'NOT_FOUND'});
 await manager.close();await host.close();manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 const page=await manager.command('drafts',{});assert.equal(page.items.length,1);assert.equal(page.items[0].title,'A result');assert.equal(page.items[0].document,undefined);
 assert.equal((await manager.command('draft',{...ref,readOnly:true})).draft.document.content[0].content[0].text,'An offline observation');
 // Editing in another local session must not let an old recovery view erase it.
 const newer=await manager.command('draft',{...ref,document:proseDocument('A newer observation')});assert.notEqual(newer.revision,saved.revision);
 await assert.rejects(manager.command('draft',{...ref,document:null,expectedRevision:saved.revision}),{code:'DRAFT_CHANGED'});
 host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});const renewed=await host.card(f.grant.id);
 assert.deepEqual(await manager.command('connect',{card:renewed,verifiedFingerprint:renewed.identity.id}),{id});assert.equal((await manager.command('state')).connections.length,1);
 assert.equal((await manager.command('draft',{...ref})).draft.revision,newer.revision);
 await manager.command('draft',{...ref,document:null,expectedRevision:newer.revision});assert.equal((await manager.command('drafts',{})).items.length,0);
});

test('draft recovery pages every field and authoring session, rejects invalid fields and preserves independent versions',async t=>{
 const f=await collaborationFixture(t),drafts=new LiveDrafts(f.member.workspace),connectionId=randomUUID(),recordId=f.book.entries[0].id,clientId=randomUUID(),document=proseDocument('Local notes');
 for(let i=0;i<25;i++)await drafts.command({connectionId,recordId,field:i?'section:'+randomUUID():'body',clientId,title:'Record '+i,fieldTitle:'Field '+i,document});
 const first=await drafts.list(),second=await drafts.list({after:first.next});assert.equal(first.items.length,20);assert.equal(second.items.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.items,...second.items].map(d=>d.field)).size,25);
 const another=randomUUID();await drafts.command({connectionId,recordId,field:'body',clientId:another,document:proseDocument('Another window')});
 const both=await drafts.command({connectionId,recordId,field:'body',clientId});assert.equal(both.others.length,1);assert.equal(both.others[0].clientId,another);assert.notDeepEqual(both.draft.document,both.others[0].document);
 for(const field of ['', 'body/../key','section:no-id'])await assert.rejects(drafts.command({connectionId,recordId,field,clientId,document}),{code:'COLLABORATION_INVALID'});
 await assert.rejects(drafts.list({after:'../private'}),{code:'COLLABORATION_INVALID'});
});
