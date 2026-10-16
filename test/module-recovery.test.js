import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleRecovery} from '../src/web/modules/recovery.js';
import {randomUUID} from 'node:crypto';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const workspaceId=randomUUID(),moduleId='resources';
const page=(drafts=[],nextCursor=null,previousCursor=null)=>({workspaceId,drafts,nextCursor,previousCursor});
const summary=()=>({id:randomUUID(),moduleId,revision:'a'.repeat(64),updatedAt:new Date().toISOString(),count:1,titles:['Retained draft']});
test('recovery serializes overlapping flushes and deletion, uses latest etags, and retains edits arriving during a write',async t=>{
 const previous=globalThis.sessionStorage,values=new Map();
 globalThis.sessionStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 t.after(()=>{globalThis.sessionStorage=previous;});
 const calls=[],gates=[],etag=new Map(),old=summary();let active=0;
 const api=async(route,body)=>{
  if(route.endsWith('/list'))return page(etag.has(old.id)?[]:[old]);
  assert.equal(active++,0,'Checkpoint writes must never overlap');
  assert.equal(body.etag,etag.get(body.id)??(body.id===old.id?old.revision:null));
  calls.push(structuredClone(body));
  await new Promise(resolve=>gates.push(resolve));
  active--;const next='etag-'+calls.length;etag.set(body.id,next);return {etag:next};
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 recovery.schedule([{data:{title:'First'}}]);const first=recovery.flush();await turn();
 recovery.schedule([{data:{title:'Latest'}}]);const second=recovery.flush(),third=recovery.flush(),remove=recovery.remove(old.id);await turn();
 assert.equal(calls.length,1);gates.shift()();await turn();
 assert.equal(calls.length,2);assert.equal(calls[1].id,old.id);gates.shift()();await turn();
 assert.equal(calls.length,3);assert.equal(calls[2].drafts[0].data.title,'Latest');gates.shift()();
 await Promise.all([first,second,third,remove]);assert.equal(calls.length,3);assert.equal(recovery.error,null);
});
test('recovery retries bounded lock contention but never retries a conflicting checkpoint',async t=>{
 const previous=globalThis.sessionStorage;
 globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};t.after(()=>{globalThis.sessionStorage=previous;});
 let tries=0,conflict=false;
 const api=async(route)=>{
  if(route.endsWith('/list'))return page();
  tries++;if(conflict)throw {code:'DRAFT_CHANGED'};
  if(tries<3)throw {code:'LOCKED'};return {etag:'saved'};
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 recovery.schedule([{data:{title:'Retained'}}]);await recovery.flush();assert.equal(tries,3);assert.equal(recovery.error,null);
 conflict=true;recovery.schedule([{data:{title:'Competing'}}]);await recovery.flush();
 assert.equal(tries,4);assert.equal(recovery.error.code,'DRAFT_CHANGED');
});

test('a new editor does not reuse an empty checkpoint after reload',async t=>{
 const seen=new Map();
 const api=async(route,body)=>{
  if(route.endsWith('/list'))return page();
  assert.equal(body.etag,seen.get(body.id)??null);
  const etag=crypto.randomUUID();seen.set(body.id,etag);return {etag};
 };
 const first=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>first.stop());
 first.schedule([{data:{title:'Old'}}]);await first.flush();first.schedule([]);await first.flush();first.stop();
 const next=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>next.stop());
 next.schedule([{data:{title:'New'}}]);await next.flush();
 assert.equal(next.error,null);assert.equal(seen.size,2);
});

test('failed and stale recovery pages retain the last valid page, retry the selected cursor and stop on disposal',async t=>{
 const first=summary(),second=summary(),requests=[];let fail=false,release,hold=false;
 const api=async(route,body,options)=>{
  requests.push({body,options});
  if(hold){hold=false;await new Promise(resolve=>release=resolve);return page([first]);}
  if(fail){fail=false;throw Error('Interrupted list');}
  return body.cursor==='next'?page([second],null,'back'):page([first],'next');
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 assert.deepEqual(recovery.available,[first]);fail=true;await recovery.load('next');
 assert.match(recovery.listError.message,/Interrupted/);assert.deepEqual(recovery.available,[first]);
 await recovery.retry();assert.equal(requests.at(-1).body.cursor,'next');assert.deepEqual(recovery.available,[second]);
 hold=true;const late=recovery.refresh();await turn();const old=requests.at(-1);await recovery.load('next');assert.equal(old.options.signal.aborted,true);
 release();await late;assert.deepEqual(recovery.available,[second]);
 hold=true;const pending=recovery.refresh();await turn();recovery.stop();assert.equal(requests.at(-1).options.signal.aborted,true);release();await pending;assert.deepEqual(recovery.available,[]);
});

test('invalid recovery results fail visibly without losing the previous page',async t=>{
 const draft=summary();let result=page([draft]);
 const recovery=await moduleRecovery({api:async()=>result,workspaceId,moduleId});t.after(()=>recovery.stop());
 for(const invalid of [page([draft,draft]),{...page([draft]),workspaceId:randomUUID()},page([{...draft,moduleId:'other'}]),page([{...draft,revision:'bad'}]),page([{...draft,titles:null}])]){
  result=invalid;await recovery.refresh();assert.ok(recovery.listError);assert.deepEqual(recovery.available,[draft]);
 }
});

test('parking rotates the active writer only after its checkpoint is durable',async t=>{
 const saved=new Map(),calls=[];let fail=false;
 const api=async(route,body)=>{
  if(route.endsWith('/list'))return page([...saved.entries()].filter(([id])=>id!==body.excludeId).slice(0,10).map(([id,value])=>({id,moduleId,revision:value.etag,updatedAt:new Date().toISOString(),count:value.drafts.length,titles:value.drafts.slice(0,3).map(d=>d.data.title)})));
  calls.push(structuredClone(body));if(fail)throw Error('Synthetic disk full');
  const value={drafts:structuredClone(body.drafts),etag:'a'.repeat(64)};saved.set(body.id,value);return value;
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 recovery.schedule([{data:{title:'First unfinished'}}]);fail=true;
 await assert.rejects(recovery.park(),/disk full/);const failed=calls.at(-1);
 fail=false;await recovery.park();assert.deepEqual(calls.at(-1),failed);
 await recovery.refresh();assert.equal(recovery.available[0].id,failed.id);
 recovery.schedule([{data:{title:'Second unfinished'}}]);await recovery.park();
 assert.notEqual(calls.at(-1).id,failed.id);assert.equal(calls.at(-1).etag,null);
 assert.equal(calls.at(-1).drafts.length,1);await recovery.refresh();assert.equal(recovery.available.length,2);
});

test('edits arriving during a lost reply wait for exact replay before advancing the checkpoint',async t=>{
 let durable=null,release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),calls=[];
 const api=async(route,body)=>{
  if(route.endsWith('/list'))return page();calls.push(structuredClone(body));
  if(calls.length===1){durable={body:structuredClone(body),etag:'first'};started();await gate;throw Error('Reply lost');}
  if(calls.length===2){assert.deepEqual(body,durable.body);return {etag:durable.etag};}
  assert.equal(body.etag,'first');assert.equal(body.drafts[0].data.title,'Newer input');return {etag:'second'};
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 recovery.schedule([{data:{title:'First input'}}]);const first=recovery.flush();await ready;
 recovery.schedule([{data:{title:'Newer input'}}]);release();await first;assert.ok(recovery.error);assert.equal(calls.length,1);
 await recovery.park();assert.equal(calls.length,3);assert.equal(recovery.error,null);
});


test('navigation can release only a completed checkpoint and draft writes keep their module owner',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),calls=[];
 const recovery=await moduleRecovery({workspaceId,moduleId,api:async(route,body,options)=>{
  assert.equal(options.view,'#/modules/resources');
  if(route.endsWith('/list'))return page();
  calls.push(body);await gate;return {etag:'saved'};
 }});t.after(()=>recovery.stop());
 assert.equal(recovery.canPark(),true);
 recovery.schedule([{data:{title:'Unfinished'}}]);assert.equal(recovery.canPark(),false);
 const writing=recovery.flush();await turn();assert.equal(recovery.canPark(),false);assert.equal(recovery.parkSaved(),false);assert.equal(calls.length,1);
 release();await writing;assert.equal(recovery.canPark(),true);assert.equal(recovery.parkSaved(),true);
 recovery.schedule([{data:{title:'Newer input'}}]);assert.equal(recovery.canPark(),false);
 await recovery.park();assert.equal(recovery.canPark(),true);recovery.stop();assert.equal(recovery.canPark(),false);
});


test('late save completion retires only its captured checkpoint and preserves other drafts',async t=>{
 const calls=[];let value=null;
 const api=async(route,body)=>{
  if(route.endsWith('/list'))return page();
  assert.equal(body.etag,value?.etag??null);calls.push(structuredClone(body));
  value={...structuredClone(body),etag:'revision-'+calls.length};return {etag:value.etag};
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 const first={id:randomUUID(),data:{title:'Saved before navigation'}},other={id:randomUUID(),data:{title:'Still unfinished'}};
 recovery.schedule([first,other]);await recovery.flush();const complete=recovery.completionFor(first);
 assert.equal(await complete(),false,'A live editor owns its normal checkpoint update');
 const original=value.id;recovery.stop();assert.equal(await complete(),true);
 assert.equal(value.id,original);assert.deepEqual(value.drafts,[other]);assert.equal(calls.length,2);
});

test('late save cleanup cannot remove a checkpoint changed by another recovery owner',async t=>{
 let value=null,conflict=false;
 const api=async(route,body)=>{
  if(route.endsWith('/list'))return page();
  if(conflict)throw {code:'DRAFT_CHANGED'};
  value=structuredClone(body);return {etag:'old'};
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 const draft={id:randomUUID(),data:{title:'Saved value'}};recovery.schedule([draft]);await recovery.flush();
 const complete=recovery.completionFor(draft);conflict=true;value={...value,drafts:[{...draft,data:{title:'Newer edit'}}]};recovery.stop();
 assert.equal(await complete(),false);assert.equal(value.drafts[0].data.title,'Newer edit');
});


test('late save cleanup streams a large retained sibling draft after the editor is disposed',async t=>{
 let saved=null,parts=[],transfers=0;
 const api=async(route,body)=>{
  if(route.endsWith('/list'))return page();
  if(route.endsWith('/start')){parts=[];transfers++;return {};}
  if(route.endsWith('/part')){parts[body.index]=Buffer.from(body.bytes,'base64');return {};}
  if(route.endsWith('/finish')){saved=JSON.parse(Buffer.concat(parts).toString('utf8'));return {etag:'revision-'+transfers};}
  saved=structuredClone(body);return {etag:'direct'};
 };
 const recovery=await moduleRecovery({api,workspaceId,moduleId});t.after(()=>recovery.stop());
 const first={id:randomUUID(),data:{title:'Saved'}},large={id:randomUUID(),data:{title:'Keep this draft',notes:'x'.repeat(4*1024*1024)}};
 recovery.schedule([first,large]);await recovery.flush();assert.equal(transfers,1);
 const complete=recovery.completionFor(first),original=saved.id;recovery.stop();assert.equal(await complete(),true);
 assert.equal(transfers,2);assert.equal(saved.id,original);assert.deepEqual(saved.drafts,[large]);assert.equal(saved.etag,'revision-1');
});
