import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {JobProgress} from '../src/job-progress.js';
import {AppError} from '../src/errors.js';

test('streaming progress stays bounded behind slow persistence and drains the latest value before completion',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),writes=[];let concurrent=0,maximum=0,finished=false;
 const progress=new JobProgress(async value=>{
  maximum=Math.max(maximum,++concurrent);writes.push(value);if(writes.length===1){entered.resolve();await release.promise;}concurrent--;
 },{heartbeatMs:60000});
 try{
  progress.report({stage:'hashing',done:1,total:10000});await entered.promise;
  for(let done=2;done<=10000;done++)progress.report({stage:'hashing',done,total:10000});
  assert.equal(writes.length,1,'Streaming must not enqueue a persistence operation for each chunk');
  const closing=progress.finish().then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);
  release.resolve();await closing;
  assert.equal(writes.length,2);assert.equal(writes[1].done,10000);assert.equal(maximum,1);
 }finally{release.resolve();await progress.stop();}
});

test('heartbeat and progress use the control context even when a source snapshot reports progress',async()=>{
 const context=new AsyncLocalStorage(),events=[];
 const progress=context.run('control',()=>new JobProgress(async value=>events.push({context:context.getStore(),value}),{heartbeatMs:20,progressMs:5}));
 try{
  await context.run('retained source',async()=>{progress.report({stage:'hashing',done:1,total:2});await progress.flush();});
  await delay(60);await progress.finish();
  assert.ok(events.some(event=>event.value===undefined),'Idle verification must continue renewing its lease');
  assert.ok(events.every(event=>event.context==='control'));
 }finally{await progress.stop();}
});

test('failed persistence aborts verification and prevents completion from swallowing a lost lease',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),controller=new AbortController();let writes=0;
 const progress=new JobProgress(async()=>{writes++;entered.resolve();await release.promise;throw new AppError('JOB_LEASE');},{signal:controller.signal,onError:error=>controller.abort(error)});
 try{
  progress.report({stage:'hashing',done:1,total:2});await entered.promise;progress.report({stage:'hashing',done:2,total:2});
  release.resolve();await assert.rejects(progress.finish(),{code:'JOB_LEASE'});
  assert.equal(controller.signal.reason.code,'JOB_LEASE');assert.equal(writes,1);
  assert.throws(()=>progress.report({stage:'hashing',done:2,total:2}),{code:'JOB_LEASE'});
 }finally{release.resolve();await progress.stop();}
});
