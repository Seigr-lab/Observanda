import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,createConnection} from 'node:net';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {createCatalogueConnections} from '../src/catalogue-connections.js';
import {withDatabaseRequest} from '../src/database-request-context.js';
import {AppError} from '../src/errors.js';
import {DATABASE_RESPONSE_TIMEOUT_MS} from '../src/database-query.js';

// Only sockets created by this fixture are interrupted. The database and
// unrelated workspace clients remain online throughout the experiment.
async function interruptedRoute(target) {
 const sockets=new Set();let online=true,hold=null;
 const server=createServer(peer=>{
  if(!online){peer.destroy();return;}
  const upstream=createConnection({host:target.hostname,port:Number(target.port)});
  for(const socket of [peer,upstream]){sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));}
  peer.once('close',()=>upstream.destroy());upstream.once('close',()=>peer.destroy());
  peer.pipe(upstream);upstream.on('data',chunk=>{if(hold)hold.resolve();else peer.write(chunk);});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=new URL(target);address.hostname='127.0.0.1';address.port=String(server.address().port);
 const disconnect=async()=>{online=false;await Promise.all([...sockets].map(socket=>new Promise(resolve=>{socket.once('close',resolve);socket.destroy();})));};
 return {address:address.href,disconnect,reconnect(){online=true;hold=null;},holdReplies(){hold=Promise.withResolvers();return hold.promise;},get active(){return sockets.size;},async close(){await disconnect();await new Promise(resolve=>server.close(resolve));}};
}

test('socket loss rolls back partial catalogue writes and scoped owners reconnect without changing another workspace',{timeout:90000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-connection-loss-')),vaults=[];
 let route,owner;
 t.after(async()=>{
  try{await owner?.close();}finally{try{await route?.close();}finally{
   for(const vault of vaults)clearVault(vault);
   assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-connection-loss-'));
   await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }}
 });
 const first=await encryptedFixture(path.join(directory,'first'),sampleNotebook());vaults.push(first.vault);
 const second=await encryptedFixture(path.join(directory,'second'),sampleNotebook());vaults.push(second.vault);
 const ws=first.workspace,other=second.workspace;
 route=await interruptedRoute(new URL(process.env.OBSERVANDA_DATABASE_URL));
 const env={...process.env,OBSERVANDA_DATABASE_URL:route.address},open=ws.openCatalogue.bind(ws);
 t.mock.method(ws,'openCatalogue',options=>open({...options,env}));
 const read=workspace=>workspace.catalogue(async store=>({stable:await store.object('network-stable'),partial:await store.object('network-partial')}));
 const save=(workspace,value)=>workspace.withLock(()=>workspace.catalogue(store=>store.putObject('network-stable',{value})));
 await save(ws,1);await save(other,77);
 owner=createCatalogueConnections(ws);
 await owner.run(()=>read(ws));await owner.run(()=>save(ws,2));
 assert.equal(route.active,4,'separate retained read and write sockets are open');
 let entered=false,completed=false;
 await assert.rejects(owner.run(()=>ws.withLock(()=>ws.catalogue(async store=>{
  entered=true;await store.putObject('network-partial',{value:'uncommitted'});
  await route.disconnect();
  // A second command observes the broken transport before COMMIT. Both writes
  // must roll back; failure must not be reported as a successful saved result.
  await store.putObject('network-stable',{value:99});completed=true;
 }))));
 assert.equal(entered,true);assert.equal(completed,false);assert.equal(route.active,0);
 assert.deepEqual(await read(other),{stable:{value:77},partial:null});
 // The stale reader must fail explicitly once, release its old connection,
 // and permit a fresh request after connectivity returns.
 await assert.rejects(owner.run(()=>read(ws)));
 let offlineWriterEntered=false;
 await assert.rejects(owner.run(()=>ws.withLock(()=>{offlineWriterEntered=true;})));
 assert.equal(offlineWriterEntered,false);
 route.reconnect();
 assert.deepEqual(await owner.run(()=>read(ws)),{stable:{value:2},partial:null});
 await owner.run(()=>save(ws,3));
 assert.deepEqual(await owner.run(()=>read(ws)),{stable:{value:3},partial:null});
 assert.deepEqual(await read(other),{stable:{value:77},partial:null});
 await owner.close();owner=null;
 assert.deepEqual(await read(ws),{stable:{value:3},partial:null});
 await route.close();route=null;
});


for(const mode of ['cancel','deadline'])test(mode+' of a stalled database reply closes its transaction and permits a fresh read',{timeout:90000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-stalled-reply-'));
 let route,owner,vault,pending,settled=false;
 t.after(async()=>{
  try{if(!settled)await route?.disconnect();await pending;await owner?.close();}finally{
   try{await route?.close();}finally{if(vault)clearVault(vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-stalled-reply-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
  }
 });
 const f=await encryptedFixture(directory,sampleNotebook());vault=f.vault;
 route=await interruptedRoute(new URL(process.env.OBSERVANDA_DATABASE_URL));
 const ws=f.workspace,open=ws.openCatalogue.bind(ws),env={...process.env,OBSERVANDA_DATABASE_URL:route.address};
 t.mock.method(ws,'openCatalogue',options=>open({...options,env}));
 owner=createCatalogueConnections(ws);
 const controller=new AbortController(),ready=Promise.withResolvers();
 const run=operation=>mode==='cancel'?owner.run(operation):operation();
 pending=withDatabaseRequest(controller.signal,()=>run(()=>ws.withLock(()=>ws.catalogue(async store=>{
  await store.putObject('network-uncommitted',{value:1});
  const held=route.holdReplies();ready.resolve(held);
  await store.putObject('network-after-loss',{value:2});
 })))).then(()=>{settled=true;return {saved:true};},error=>{settled=true;return {error};});
 // Wait until an actual backend reply has been discarded, so cancellation
 // cannot pass merely by preventing a query that has not yet started.
 await ready.promise;const reason=mode==='cancel'?new AppError('DATABASE_CANCELLED'):null;if(reason)controller.abort(reason);
 let timer;const outcome=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),mode==='cancel'?2000:DATABASE_RESPONSE_TIMEOUT_MS+5000);})]);clearTimeout(timer);
 assert.notEqual(outcome,null,'the active database query ignored its '+mode+' boundary');
 if(reason)assert.equal(outcome.error,reason);else assert.equal(outcome.error.code,'DATABASE_UNAVAILABLE');route.reconnect();
 const state=await owner.run(()=>ws.catalogue(async store=>[await store.object('network-uncommitted'),await store.object('network-after-loss')]));
 assert.deepEqual(state,[null,null]);
});
