import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {databaseQuery,DATABASE_RESPONSE_TIMEOUT_MS,DATABASE_STATEMENT_TIMEOUT_MS} from '../src/database-query.js';
import {withDatabaseRequest} from '../src/database-request-context.js';
import {AppError} from '../src/errors.js';
import {OperationalDiagnostics,withDiagnostics,diagnostic} from '../src/operational-diagnostics.js';

test('query diagnostics count returned scalar bytes without retaining values or serializing objects',async()=>{
 const sink=new OperationalDiagnostics(),secret='private-query-value',f=fixture();
 const nested={toJSON(){throw Error('Diagnostics must not serialize values');}},blob=Buffer.from(secret),label='\u03bb';
 const value=[{rows:[{blob,label,amount:7,nested},{empty:null}]},{rows:[[Buffer.alloc(5),secret]]}];
 await withDiagnostics(sink,async()=>{
  const pending=databaseQuery(f.client,'SELECT $1',[secret]);f.result.resolve(value);
  assert.equal(await pending,value);diagnostic('request',{route:'records'});
  await databaseQuery(f.client,'SELECT $1',[secret]);
 });
 const {entries}=await sink.snapshot();assert.equal(entries.length,1);
 assert.equal(entries[0].databaseQueries,1);assert.equal(entries[0].databaseReturnedRows,3);
 assert.equal(entries[0].databaseBufferBytes,blob.length+5);assert.equal(entries[0].databaseTextBytes,Buffer.byteLength(label)+Buffer.byteLength(secret));
 assert.doesNotMatch(JSON.stringify(entries),new RegExp(secret+'|SELECT|nested'));
});

function fixture(){const result=Promise.withResolvers(),closed=Promise.withResolvers();let calls=0,ends=0,destroyed=0;return {result,closed,get destroyed(){return destroyed;},get calls(){return calls;},get ends(){return ends;},client:{connection:{stream:{destroy(){destroyed++;}}},query:()=>{calls++;return result.promise;},end:()=>{ends++;return closed.promise;}}};}
test('query completion removes request cancellation and preserves database results',async()=>{
 const f=fixture(),controller=new AbortController(),value={rows:[{count:'6'}]};
 const pending=withDatabaseRequest(controller.signal,()=>databaseQuery(f.client,'SELECT 6'));
 assert.equal(getEventListeners(controller.signal,'abort').length,1);f.result.resolve(value);
 assert.equal(await pending,value);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 controller.abort();assert.equal(f.ends,0);assert.equal(f.calls,1);
});
test('active cancellation drains the broken connection and preserves the original reason',async()=>{
 const f=fixture(),controller=new AbortController(),reason=new AppError('DATABASE_CANCELLED');
 const pending=databaseQuery(f.client,'UPDATE objects SET payload=$1',['synthetic'],{signal:controller.signal});
 const rejected=assert.rejects(pending,error=>error===reason);let finished=false;rejected.then(()=>{finished=true;});
 controller.abort(reason);assert.equal(f.ends,1);assert.equal(f.destroyed,1);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 f.result.reject(Error('transport closed'));await Promise.resolve();assert.equal(finished,false);
 f.closed.resolve();await rejected;assert.equal(f.calls,1);
});
test('a pre-cancelled request sends no query or termination to a borrowed connection',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(databaseQuery(f.client,'SELECT 1',[],{signal:controller.signal}),error=>error===controller.signal.reason);
 assert.equal(f.calls,0);assert.equal(f.ends,0);
});
test('the response deadline closes a silent transport after the server statement budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();
 const pending=databaseQuery(f.client,'COMMIT'),rejected=assert.rejects(pending,{code:'DATABASE_UNAVAILABLE'});
 assert.ok(DATABASE_RESPONSE_TIMEOUT_MS>DATABASE_STATEMENT_TIMEOUT_MS);
 t.mock.timers.tick(DATABASE_RESPONSE_TIMEOUT_MS-1);assert.equal(f.ends,0);
 t.mock.timers.tick(1);assert.equal(f.ends,1);assert.equal(f.destroyed,1);f.closed.resolve();await rejected;
 f.result.resolve({rows:[]});assert.equal(f.calls,1,'an uncertain commit is never retried');
});
test('ordinary SQL refusal remains unchanged and clears the response deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),error=Object.assign(Error('statement refused'),{code:'23505'});
 const pending=databaseQuery(f.client,'INSERT INTO objects VALUES ($1)',['value']);f.result.reject(error);
 await assert.rejects(pending,value=>value===error);t.mock.timers.tick(DATABASE_RESPONSE_TIMEOUT_MS);assert.equal(f.ends,0);
});
test('each reused-connection query takes the current request signal',async()=>{
 const f=fixture(),first=new AbortController(),second=new AbortController();f.result.resolve({rows:[]});
 await withDatabaseRequest(first.signal,()=>databaseQuery(f.client,'SELECT 1'));first.abort();
 await withDatabaseRequest(second.signal,()=>databaseQuery(f.client,'SELECT 2'));assert.equal(f.calls,2);assert.equal(f.ends,0);
});
