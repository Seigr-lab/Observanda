import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {connectManagedAdmin,verifyManagedApplication} from '../src/postgres-runtime-readiness.js';
import {setTimeout as delay} from 'node:timers/promises';

const message=(type,body)=>{const size=Buffer.alloc(4);size.writeInt32BE(body.length+4);return Buffer.concat([Buffer.from(type),size,body]);};
test('managed administrator waits for the new endpoint after a stale launcher readiness result',{timeout:5000},async t=>{
 const peers=new Set(),server=createServer(socket=>{peers.add(socket);socket.on('error',()=>{});socket.on('close',()=>peers.delete(socket));socket.once('data',()=>socket.write(Buffer.concat([message('R',Buffer.alloc(4)),message('Z',Buffer.from('I'))])));socket.resume();});
 t.after(async()=>{for(const socket of peers)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 let settled=false;const pending=connectManagedAdmin({port,adminPassword:'synthetic-password'},{deadline:performance.now()+2000}).finally(()=>{settled=true;});
 await delay(75);assert.equal(settled,false,'connection refusal cannot publish readiness');
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));const client=await pending;
 assert.equal(peers.size,1);await client.end();
});

test('managed administrator refuses authentication failures without retrying them',{timeout:5000},async t=>{
 let accepted=0;const peers=new Set(),server=createServer(socket=>{accepted++;peers.add(socket);socket.on('error',()=>{});socket.on('close',()=>peers.delete(socket));socket.once('data',()=>socket.end(message('E',Buffer.from('SFATAL\0C28P01\0MAuthentication refused\0\0'))));socket.resume();});
 t.after(async()=>{for(const socket of peers)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await assert.rejects(connectManagedAdmin({port:server.address().port,adminPassword:'synthetic-password'}),{code:'28P01'});assert.equal(accepted,1);
});

test('managed administrator bounds unavailable startup and cancels a stalled authentication handshake',{timeout:5000},async t=>{
 const peers=new Set();let entered;const accepted=new Promise(resolve=>entered=resolve),server=createServer(socket=>{peers.add(socket);socket.on('error',()=>{});socket.on('close',()=>peers.delete(socket));socket.resume();entered();});
 t.after(async()=>{for(const socket of peers)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 await assert.rejects(connectManagedAdmin({port,adminPassword:'synthetic-password'},{deadline:performance.now()+120}),{code:'DATABASE_RUNTIME'});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));const controller=new AbortController(),pending=connectManagedAdmin({port,adminPassword:'synthetic-password'},{signal:controller.signal});
 const rejected=assert.rejects(pending,{code:'DATABASE_CANCELLED'});await accepted;controller.abort();await rejected;
 await assert.rejects(connectManagedAdmin({port,adminPassword:'synthetic-password'},{signal:controller.signal}),{code:'DATABASE_CANCELLED'});
});

test('managed application readiness cancels a stalled startup handshake and closes its socket',async t=>{
 const peers=new Set();let accepted,closed;const connected=new Promise(resolve=>accepted=resolve),disconnected=new Promise(resolve=>closed=resolve);
 const server=createServer(socket=>{peers.add(socket);socket.on('error',()=>{});socket.on('close',()=>{peers.delete(socket);closed();});socket.resume();accepted();});
 t.after(async()=>{for(const socket of peers)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const controller=new AbortController(),pending=verifyManagedApplication({port:server.address().port,appPassword:'synthetic-password'},{signal:controller.signal});
 const rejected=assert.rejects(pending,{code:'DATABASE_CANCELLED'});await connected;controller.abort();await rejected;await disconnected;assert.equal(peers.size,0);
});

test('managed application readiness rejects cancellation before opening a connection',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(verifyManagedApplication({port:1,appPassword:'synthetic-password'},{signal:controller.signal}),{code:'DATABASE_CANCELLED'});
});
