import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import https from 'node:https';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';

test('enrolled TLS clients behind one address remain admitted during bounded unauthenticated challenge traffic',async t=>{
 const f=await collaborationFixture(t),host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const card=await host.card(f.grant.id),clients=Array.from({length:4},()=>new LiveClient(f.member.deviceStore,card));t.after(()=>clients.forEach(client=>client.close()));
 const [a,b,floodA,floodB]=clients;let issued=0,stop=false;const failures=[],latencies=[];
 const issue=async client=>{await client.request('/challenge',{});issued++;};
 // More than the old retained challenge capacity, without providing a peer
 // identity. Neither source address nor unused nonce count reserves capacity.
 for(let i=0;i<260;i++)await Promise.all([issue(floodA),issue(floodB)]);
 const loops=[floodA,floodB].map(async client=>{for(let i=0;i<2048&&!stop;i++)try{await issue(client);}catch(error){failures.push(error.code);}});
 try{
  for(let round=0;round<3;round++)await Promise.all([a,b].map(async client=>{const start=performance.now(),result=await client.call('list');latencies.push(Math.round(performance.now()-start));assert.equal(result.records.length,2);assert.ok(!JSON.stringify(result).includes('Unrelated private'));}));
 }finally{stop=true;await Promise.all(loops);}
 assert.deepEqual(failures,[]);assert.ok(issued>520);t.diagnostic(JSON.stringify({issued,legitimateRequests:latencies.length,latenciesMs:latencies}));
 // Incomplete challenge bodies receive a stateless challenge and close;
 // request slots stay reserved until closure and cannot be held indefinitely.
 for(let batch=0;batch<4;batch++)await Promise.all(Array.from({length:3},()=>new Promise((resolve,reject)=>{
  const request=https.request(new URL('/challenge',a.card.endpoint),{method:'POST',agent:false,ca:a.card.certificate,servername:'observanda.local',minVersion:'TLSv1.3',headers:{'Content-Type':'application/json','Content-Length':'2'}},response=>{
   try{assert.equal(response.statusCode,200);assert.equal(response.headers.connection,'close');}catch(error){request.destroy();reject(error);return;}
   response.resume();response.on('end',()=>{request.destroy();resolve();});
  });
  request.on('error',reject);request.setTimeout(5000,()=>request.destroy(new Error('Challenge waited for an unused body')));request.write('{');
 })));
 assert.equal((await a.call('list')).records.length,2);
 const challenge=await a.request('/challenge',{}),{workspaceId,organizationId,grantId}=a.card;
 const signed=await a.identity.sign({kind:'observanda.live.request.v1',...challenge,scope:{workspaceId,organizationId,grantId},operation:'list',data:{}});
 assert.equal((await a.request('/request',signed)).records.length,2);
 await assert.rejects(a.request('/request',signed),{code:'COLLABORATION_EXPIRED'});
 await assert.rejects(b.request('/request',signed),{code:'COLLABORATION_EXPIRED'});
 await assert.rejects(a.request('/request',{...signed,signature:'A'.repeat(512)}),{code:'COLLABORATION_SIGNATURE'});
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,active:false});
 await assert.rejects(a.call('list'),{code:'COLLABORATION_DENIED'});
});
