import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {PdfExportService} from '../src/pdf-export-service.js';
import {AppError} from '../src/errors.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('PDF service schedules an immediate cancelled-attempt retry only after its previous worker settles',{timeout:3000},async t=>{
 const service=new PdfExportService({}),workspaceId=randomUUID(),id=randomUUID(),key=workspaceId+':'+id,entered=[deferred(),deferred()],release=[deferred(),deferred()];let state='queued',attempt=0,live=0,maximum=0,retryChecks=0;
 t.after(async()=>{release.forEach(gate=>gate.resolve());await service.close();});
 service.queue=()=>({work:async(selected,{signal,check})=>{
  assert.equal(selected,id);await check();assert.equal(state,'queued');const current=attempt++;state='rendering';maximum=Math.max(maximum,++live);entered[current].resolve();
  try{await release[current].promise;signal.throwIfAborted();if(state==='rendering')state='completed';}finally{live--;}
 }});
 service.schedule(workspaceId,id);await entered[0].promise;state='cancelled';state='queued';service.schedule(workspaceId,id,{check:async()=>{retryChecks++;}});
 await nextTurn();assert.equal(attempt,1);assert.equal(state,'queued');release[0].resolve();await entered[1].promise;assert.equal(attempt,2);assert.ok(retryChecks>0);assert.equal(maximum,1);
 const finished=service.pending.get(key);release[1].resolve();await finished;assert.equal(state,'completed');assert.equal(service.pending.size,0);
});

test('closing a queued PDF service releases its lifetime without waiting for a different owner renderer',{timeout:3000},async()=>{
 const first=new PdfExportService({}),second=new PdfExportService({}),entered=deferred(),release=deferred(),firstWorkspace=randomUUID(),firstId=randomUUID();let secondCalls=0,keyLive=true;
 first.queue=()=>({work:async()=>{entered.resolve();await release.promise;}});
 second.queue=()=>({work:async()=>{secondCalls++;assert.equal(keyLive,true);}});
 try{
  first.schedule(firstWorkspace,firstId);await entered.promise;second.schedule(randomUUID(),randomUUID());assert.equal(second.pending.size,1);
  let closed=false;const closing=second.close().then(()=>{closed=true;});await nextTurn();assert.equal(closed,true);await closing;keyLive=false;assert.equal(second.pending.size,0);
  const pending=first.pending.get(firstWorkspace+':'+firstId);release.resolve();await pending;await nextTurn();assert.equal(secondCalls,0);assert.throws(()=>second.schedule(randomUUID(),randomUUID()),{code:'ACCESS_LOCKED'});
 }finally{release.resolve();await Promise.all([first.close(),second.close()]);}
});
