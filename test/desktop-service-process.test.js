import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {launchService} from '../desktop/service-process.js';

test('standalone desktop service keeps IPC without Electron node mode or inherited Node arguments',{timeout:15000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-service-process-')),file=path.join(directory,'service with spaces.mjs');let child;
 t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'close');child.kill();await ended;}assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-service-process-'));await rm(directory,{recursive:true,force:true});});
 await writeFile(file,`process.send({ready:true,options:process.env.NODE_OPTIONS??null,nodeMode:process.env.ELECTRON_RUN_AS_NODE??null,arguments:process.execArgv});process.once('message',value=>process.send({ack:value.id},()=>process.disconnect()));`);
 child=launchService(process.execPath,file,{...process.env,NODE_OPTIONS:'--require nonexistent-module',ELECTRON_RUN_AS_NODE:'1'});child.stdout.resume();child.stderr.resume();
 const exited=once(child,'exit'),[ready]=await once(child,'message');assert.deepEqual(ready,{ready:true,options:null,nodeMode:null,arguments:[]});
 const reply=once(child,'message');child.send({id:'shutdown-check'});assert.deepEqual((await reply)[0],{ack:'shutdown-check'});assert.deepEqual(await exited,[0,null]);
});

test('a missing standalone runtime reports an error without launching a fallback',async()=>{
 const child=launchService(path.join(os.tmpdir(),'observanda-missing-runtime','node'),'unused',process.env),closed=once(child,'close').catch(()=>{});
 const error=await new Promise(resolve=>child.once('error',resolve));assert.equal(error.code,'ENOENT');await closed;assert.equal(child.pid,undefined);
});
