import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {serviceHealth,probeDatabaseHealth} from '../src/service-health.js';

test('real connection readiness attributes scratch and selected authentication failures independently',async()=>{
 const healthy=process.env,url=new URL(healthy.OBSERVANDA_DATABASE_URL);url.password='invalid-synthetic-health-password';
 const broken={...healthy,OBSERVANDA_DATABASE_URL:url.href};let selected=healthy,scratch=broken;
 const provider={healthEnvironments:()=>({selected,scratch})};
 let report=await serviceHealth({root:'unused-synthetic-owner',locked:false,provider});assert.equal(report.scratch.ready,false);assert.equal(report.selectedWorkspace.ready,true);
 selected=broken;scratch=healthy;report=await serviceHealth({root:'unused-synthetic-owner',locked:false,provider});assert.equal(report.scratch.ready,true);assert.equal(report.selectedWorkspace.ready,false);
 assert.doesNotMatch(JSON.stringify(report),/invalid-synthetic|unused-synthetic|postgresql:\/\//);
});
test('a server that accepts TCP but never speaks PostgreSQL cannot retain a health slot',async t=>{
 const sockets=new Set(),server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 const env={OBSERVANDA_DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:'+server.address().port+'/synthetic'};
 const first=await probeDatabaseHealth(env,{timeoutMs:50});assert.equal(first.ready,false);assert.equal(first.code,'DATABASE_UNAVAILABLE');
 assert.equal((await probeDatabaseHealth(process.env)).ready,true);
});
