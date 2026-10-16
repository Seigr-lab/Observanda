import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {LiveConnections} from '../src/collaboration/live-connections.js';
import {OrganizationIdentity} from '../src/collaboration/identity.js';
import {startServer} from '../src/server.js';

const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};

test('closed clients cannot send a pending signed command or recreate a cached connection',async t=>{
 const f=await collaborationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'});t.after(()=>host.close());
 const card=await host.card(f.grant.id),client=new LiveClient(f.member.deviceStore,card);t.after(()=>client.close());
 const signing=gate(),resume=gate(),sign=client.identity.sign.bind(client.identity);t.after(()=>resume.release());
 client.identity.sign=async value=>{signing.release();await resume.promise;return sign(value);};
 const call=client.call('comment',{recordId:f.book.entries[0].id,id:randomUUID(),text:'Must not be sent'}),rejected=assert.rejects(call,{code:'ACCESS_LOCKED'});
 await signing.promise;client.close();resume.release();await rejected;
 const verifier=new LiveClient(f.member.deviceStore,card);t.after(()=>verifier.close());assert.equal((await verifier.call('comments',{recordId:f.book.entries[0].id})).count,0);
 const manager=new LiveConnections(f.member.workspace,f.member.deviceStore);t.after(()=>manager.close());const {id}=await manager.command('connect',{card,verifiedFingerprint:card.identity.id});
 manager.clients.get(id).close();manager.clients.clear();
 const reading=gate(),continueRead=gate(),read=f.member.workspace.readMetadata.bind(f.member.workspace);t.after(()=>continueRead.release());
 t.mock.method(f.member.workspace,'readMetadata',async(...args)=>{const result=await read(...args);if(args[0].endsWith('/connections/'+id+'.json')){reading.release();await continueRead.promise;}return result;});
 const late=assert.rejects(manager.command('request',{connectionId:id,operation:'list'}),{code:'ACCESS_LOCKED'});await reading.promise;
 const closed=manager.close();continueRead.release();await Promise.all([closed,late]);assert.equal(manager.clients.size,0);
});

test('locking a local installation drains pending peer requests and never sends them after the lock',async t=>{
 const f=await collaborationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'});t.after(()=>host.close());
 const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'live-prefs')});t.after(()=>app.close());
 const workspaceId=(await f.member.workspace.outline()).metadata.id,headers={Origin:app.origin,'Content-Type':'application/json'};
 const request=(operation,data={})=>fetch(app.origin+'/api/live/'+operation,{method:'POST',headers,body:JSON.stringify({workspaceId,...data})});
 assert.equal((await request('state')).status,401);
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers,body:JSON.stringify({token:app.launchToken})});headers.Cookie=session.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('state',{workspaceId:randomUUID()})).status,409);
 const card=await host.card(f.grant.id),connected=await request('connect',{card,verifiedFingerprint:card.identity.id});assert.equal(connected.status,200);const {id}=await connected.json();
 const signing=gate(),resume=gate(),closing=gate(),sign=OrganizationIdentity.prototype.sign,close=LiveConnections.prototype.close;t.after(()=>resume.release());
 t.mock.method(OrganizationIdentity.prototype,'sign',async function(value){if(value.kind==='observanda.live.request.v1'&&value.operation==='comment'){signing.release();await resume.promise;}return sign.call(this,value);});
 t.mock.method(LiveConnections.prototype,'close',function(){const result=close.call(this);closing.release();return result;});
 const pending=request('request',{connectionId:id,operation:'comment',data:{recordId:f.book.entries[0].id,id:randomUUID(),text:'Do not send after locking'}});await signing.promise;
 const locked=fetch(app.origin+'/api/access/lock',{method:'POST',headers,body:'{}'});
 // This barrier also proves the pending peer operation did not reject locking
 // as an unrelated local write. Release signing only after shutdown began.
 await closing.promise;resume.release();assert.equal((await locked).status,200);assert.equal((await pending).status,401);
 assert.equal((await request('state')).status,401);
 const verifier=new LiveClient(f.member.deviceStore,card);t.after(()=>verifier.close());assert.equal((await verifier.call('comments',{recordId:f.book.entries[0].id})).count,0);
});
