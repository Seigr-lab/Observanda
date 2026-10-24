import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NumericalExecutionWork,numericalExecutionWorkFile} from '../src/numerical-execution-work.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {defaultNumericalExecutionPolicy} from '../src/web/numerical-execution-policy.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {AppError} from '../src/errors.js';
const cursor=offset=>({phase:'input',offset}),validCursor=value=>value===null||value?.phase==='input'&&Number.isSafeInteger(value.offset)&&value.offset>=0;
function fixture(){
 const files=new Map(),writes=[],jobId=randomUUID(),policy=defaultNumericalExecutionPolicy();policy.total={maxOperations:100000,maxActiveMilliseconds:10000};policy.slice={maxOperations:10000,maxActiveMilliseconds:1000};const command={id:randomUUID(),spectrum:{version:2,executionPolicy:policy}},workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,text)=>{writes.push(key);files.set(key,text);}},materials={workspace,sequences:new MaterialSequence(workspace)};let lease=1;
 const owner=(extra={})=>{const token=lease;return new NumericalExecutionWork(materials,command,{jobId,validCursor,writePage:async operation=>{if(token!==lease)throw new AppError('JOB_LEASE');const prior=new Map(files);try{return await operation();}catch(error){files.clear();for(const [key,value]of prior)files.set(key,value);throw error;}},...extra});};
 return {files,writes,command,materials,jobId,owner,loseLease(){lease++;},saved(){return JSON.parse(files.get(numericalExecutionWorkFile(jobId)));}};
}
test('a reservation precedes CPU and values/cursor/actual use settle together in authenticated pages',async()=>{
 const f=fixture(),owner=await f.owner().open();await owner.slice(null,async({budget,work})=>{const reserved=f.saved();assert.ok(reserved.ledger.reservation);assert.equal(reserved.cursor,null);assert.equal(reserved.root,null);budget.run(b=>b.step(17));await work.putMany(Array.from({length:32},(_,i)=>['point:'+i,{real:i+'/1'}]));return cursor(32);});const saved=f.saved();assert.equal(saved.ledger.reservation,null);assert.equal(saved.ledger.consumed.operations,17);assert.deepEqual(saved.cursor,cursor(32));assert.equal(saved.root.count,32);const reopened=await f.owner().open();assert.deepEqual(await reopened.get('point:31'),{real:'31/1'});assert.equal((await reopened.getMany(['point:31','absent','point:0'])).size,2);assert.ok(f.writes.some(key=>key.startsWith('.observanda/materials/sequences/numerical-work-nodes/')));assert.ok(f.writes.some(key=>key.startsWith('.observanda/materials/sequences/numerical-work-values/')));
});
test('known refusal settles actual use without publishing changed values or cursor',async()=>{
 const f=fixture(),owner=await f.owner().open(),error=Object.assign(Error('source access revoked'),{code:'ACCESS_LOCKED'});await assert.rejects(owner.slice(null,async({budget,work})=>{budget.run(b=>b.step(5));await work.put('not-published','value');throw error;}),value=>value===error);assert.equal(f.saved().ledger.reservation,null);assert.equal(f.saved().ledger.consumed.operations,5);assert.equal(f.saved().root,null);assert.equal(await owner.get('not-published'),undefined);
});
test('a lost lease leaves an uncertain reservation and recovery charges it fully before retry',async()=>{
 const f=fixture(),owner=await f.owner().open();await assert.rejects(owner.slice(null,async({budget,work})=>{budget.run(b=>b.step(5));await work.put('uncommitted',true);f.loseLease();return cursor(1);}),{code:'JOB_LEASE'});const interrupted=f.saved();assert.equal(interrupted.ledger.consumed.operations,0);assert.equal(interrupted.ledger.reservation.operations,10000);assert.equal(interrupted.cursor,null);const resumed=await f.owner().open();assert.equal(resumed.ledger.reservation,null);assert.deepEqual(resumed.ledger.consumed,{operations:10000,activeMilliseconds:1000});assert.equal(await resumed.get('uncommitted'),undefined);await resumed.slice(null,async({budget,work})=>{budget.run(b=>b.step(7));await work.put('settled',true);return cursor(1);});assert.equal(resumed.ledger.consumed.operations,10007);assert.equal(await resumed.get('settled'),true);
});
test('stale checkpoints and different command identities cannot borrow a current ledger',async()=>{
 const f=fixture(),first=await f.owner().open(),stale=await f.owner().open();await first.slice(null,async({budget})=>{budget.run(b=>b.step());return cursor(1);});await assert.rejects(stale.slice(null,async()=>cursor(2)),{code:'MATERIAL_CHANGED'});f.command.id=randomUUID();await assert.rejects(f.owner().open(),{code:'MATERIAL_CHANGED'});
});
test('corrupt ledger or immutable numeric pages refuse rather than reconstructing trusted state',async()=>{
 const f=fixture(),owner=await f.owner().open();await owner.slice(null,async({work})=>{await work.put('value','1/1');return cursor(1);});const valuePath=f.writes.find(key=>key.startsWith('.observanda/materials/sequences/numerical-work-values/'));f.files.set(valuePath,f.files.get(valuePath).replace('1/1','2/1'));await assert.rejects((await f.owner().open()).get('value'),{code:'MATERIAL_MISSING'});const saved=f.saved();saved.ledger.consumed.operations=-1;f.files.set(numericalExecutionWorkFile(f.jobId),JSON.stringify(saved));await assert.rejects(f.owner().open(),{code:'MATERIAL_MISSING'});
});
test('large bounded work values reuse retained JSON chunks and complete reservation exhaustion refuses',async()=>{
 const f=fixture(),owner=await f.owner().open(),text='1'.repeat(300000);await owner.slice(null,async({work})=>{await work.put('long',text);return cursor(1);});assert.equal(await (await f.owner().open()).get('long'),text);assert.ok(f.writes.some(key=>key.startsWith('.observanda/materials/sequences/numerical-work-chunks/')));const saved=f.saved();saved.ledger.consumed.operations=saved.ledger.policy.total.maxOperations;f.files.set(numericalExecutionWorkFile(f.jobId),JSON.stringify(saved));await assert.rejects((await f.owner().open()).slice(cursor(1),async()=>cursor(2)),{code:'DATASET_CALCULATION_RESOURCE'});
});
test('each source keeps its scalar policy while all local operations debit one execution reservation',async()=>{
 const f=fixture(),owner=await f.owner().open(),small=defaultDatasetResourcePolicy();small.resources.maxOperations=4;await assert.rejects(owner.slice(null,async({budget})=>{const local=budget.scalarBudget(small);local.run(()=>{for(let i=0;i<5;i++)local.step();});return cursor(1);}),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(owner.ledger.reservation,null);assert.ok(owner.ledger.consumed.operations>0);assert.equal(owner.cursor,null);
});


test('ephemeral FFT work preserves bounded getMany I/O and overlays only the current staged values',async()=>{
 const f=fixture(),values=new Map(Array.from({length:64},(_,i)=>['p:'+i,i])),calls=[];let singles=0;const scratch={get:async key=>{singles++;return values.get(key);},getMany:async keys=>{calls.push([...keys]);return new Map(keys.filter(key=>values.has(key)).reverse().map(key=>[key,values.get(key)]));},putMany:async entries=>{for(const [key,value]of entries)values.set(key,value);}},owner=await f.owner({scratch}).open();assert.deepEqual([...await owner.getMany(['p:0','p:1'])],[['p:0',0],['p:1',1]]);await owner.slice(null,async({work})=>{await work.put('p:1',99);await work.put('new',100);assert.deepEqual([...await work.getMany(['p:0','p:1','new','missing'])],[['p:0',0],['p:1',99],['new',100]]);return cursor(1);});assert.deepEqual(calls,[['p:0','p:1'],['p:0','missing']]);assert.equal(singles,0);assert.equal(f.files.size,0);assert.equal(await owner.get('p:1'),99);
});


test('cancellation while awaiting an injected batched reader refuses its returned values',async()=>{
 const f=fixture(),controller=new AbortController(),scratch={getMany:async()=>{controller.abort();return new Map([['value',1]]);},putMany:async()=>{}},owner=await f.owner({scratch,signal:controller.signal}).open();await assert.rejects(owner.getMany(['value']),{name:'AbortError'});
});
