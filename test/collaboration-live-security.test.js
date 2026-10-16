import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {liveCertificate} from '../src/collaboration/live-certificate.js';
import {ResearchMaterials} from '../src/research-materials.js';

test('direct peers reject replay, forged commands, cross-scope requests and changed certificates',async t=>{
 const f=await collaborationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'});t.after(()=>host.close());
 const card=await host.card(f.grant.id),client=new LiveClient(f.member.deviceStore,card);t.after(()=>client.close());
 const {workspaceId,organizationId,grantId}=card.value,scope={workspaceId,organizationId,grantId};
 const envelope=async(extra={})=>client.identity.sign({kind:'observanda.live.request.v1',...await client.request('/challenge',{}),scope,operation:'list',data:{},...extra});
 const signed=await envelope();assert.equal((await client.request('/request',signed)).records.length,2);
 await assert.rejects(client.request('/request',signed),{code:'COLLABORATION_EXPIRED'});
 const tampered=await envelope();tampered.value.operation='read';await assert.rejects(client.request('/request',tampered),{code:'COLLABORATION_SIGNATURE'});
 await assert.rejects(client.request('/request',await envelope({instance:'0'.repeat(48)})),{code:'COLLABORATION_SIGNATURE'});
 await assert.rejects(client.request('/request',await envelope({scope:{...scope,workspaceId:randomUUID()}})),{code:'COLLABORATION_DENIED'});
 await assert.rejects(client.request('/request',await envelope({scope:{...scope,grantId:randomUUID()}})),{code:'COLLABORATION_DENIED'});
 const wrongCertificate=(await liveCertificate(f.member.workspace)).cert,wrong=new LiveClient(f.member.deviceStore,await f.a.identity.sign({...card.value,certificate:wrongCertificate}));t.after(()=>wrong.close());
 await assert.rejects(wrong.call('list'),{code:'LIVE_UNAVAILABLE'});
 const altered=structuredClone(card);altered.value.endpoint='https://127.0.0.1:1';assert.throws(()=>new LiveClient(f.member.deviceStore,altered),{code:'COLLABORATION_SIGNATURE'});
});

test('current grants protect evidence bytes and reader roles on every operation; host restart retains discussion',async t=>{
 const f=await collaborationFixture(t);let host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'});t.after(()=>host.close());
 const client=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(()=>client.close());
 const recordId=f.book.entries[0].id,materials=new ResearchMaterials(f.author.workspace),bytes=Buffer.alloc(128*1024,37);
 const add=async(id,name)=>{const upload=await materials.startImport({recordId:id,name,size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);return materials.finishImport(upload.id);};
 const shared=await add(recordId,'returned.img'),privateFile=await add(f.book.entries[2].id,'private.img');
 const original=await client.call('file',{recordId,kind:'artifact',id:shared.id},{stream:true}),hash=createHash('sha256');for await(const chunk of original)hash.update(chunk);assert.equal(hash.digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 await assert.rejects(client.call('file',{recordId,kind:'artifact',id:privateFile.id},{stream:true}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(client.call('file',{recordId:f.book.entries[2].id,kind:'artifact',id:privateFile.id},{stream:true}),{code:'COLLABORATION_DENIED'});
 for(let i=0;i<53;i++)await client.call('comment',{recordId,id:randomUUID(),text:'Discussion '+i});
 const latest=await client.call('comments',{recordId});assert.equal(latest.items.length,50);assert.equal(latest.items[0].text,'Discussion 3');assert.equal(latest.before,3);
 assert.deepEqual((await client.call('comments',{recordId,before:latest.before})).items.map(c=>c.text),['Discussion 0','Discussion 1','Discussion 2']);
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
 assert.equal((await client.call('document',{recordId,field:'body',clientId:randomUUID()})).role,'reader');
 for(const operation of ['steps','fields','comment'])await assert.rejects(client.call(operation,{recordId}),{code:'COLLABORATION_DENIED'});
 const port=host.port;client.close();await host.close();host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port,advertise:'https://127.0.0.1'});
 const reopened=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(()=>reopened.close());assert.equal((await reopened.call('comments',{recordId})).count,53);
 assert.equal((await reopened.call('evidence',{recordId})).items.find(i=>i.id===shared.id).sha256,createHash('sha256').update(bytes).digest('hex'));
 await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:2,active:false});
 await assert.rejects(reopened.call('file',{recordId,kind:'artifact',id:shared.id},{stream:true}),{code:'COLLABORATION_DENIED'});
});
