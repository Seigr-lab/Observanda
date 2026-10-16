import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {verifyManagedApplication} from '../src/postgres-runtime-readiness.js';

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
