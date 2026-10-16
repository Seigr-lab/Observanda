import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {httpDrain} from '../src/http-drain.js';

test('shutdown finishes an active response and closes idle browser sockets without waiting for their keep-alive timeout',async t=>{
 let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const server=http.createServer(async(req,res)=>{entered();await gate;res.end('saved');}),drain=httpDrain(server);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const agent=new http.Agent({keepAlive:true}),idle=net.connect(server.address().port,'127.0.0.1');
 t.after(()=>{release();idle.destroy();agent.destroy();server.closeAllConnections();server.close();});
 await once(idle,'connect');idle.resume();const idleClosed=once(idle,'close');
 const result=new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port:server.address().port,path:'/',agent},res=>{
  let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(body));
 }).on('error',reject));
 await started;let closed=false;const closing=drain.close().then(()=>{closed=true;});
 assert.equal(drain.close(),drain.close());await idleClosed;assert.equal(closed,false);
 release();assert.equal(await result,'saved');await closing;assert.equal(closed,true);
});
