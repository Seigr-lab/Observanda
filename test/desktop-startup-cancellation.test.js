import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {launchService} from '../desktop/service-process.js';

test('desktop answers status during deferred loading and cancels before starting databases',{timeout:20000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-cancel-'));
 const child=launchService(process.execPath,fileURLToPath(new URL('./fixtures/desktop-service-loading.js',import.meta.url)),process.env),messages=[];
 const ended=once(child,'close');child.stdout.resume();child.stderr.resume();child.on('message',value=>messages.push(value));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await ended;await rm(root,{recursive:true,force:true});});
 async function message(type,id){for(;;){const saved=messages.find(value=>value.type===type&&(id===undefined||value.id===id));if(saved)return saved;await once(child,'message');}}
 await message('fixture-ready');child.send({type:'start',preferencesFile:path.join(root,'preferences.json')});
 await message('modules-loading');child.send({type:'shutdown-status',id:1});
 const status=await message('shutdown-status',1);assert.equal(status.phase,'startup');assert.equal(status.busy,true);
 child.send({type:'stop'});child.send({type:'release-modules'});
 assert.deepEqual(await ended,[0,null]);assert.equal(messages.some(value=>['ready','failed'].includes(value.type)),false);
 const directory=path.join(root,'diagnostics');for(const name of await readdir(directory)){
  const bytes=await readFile(path.join(directory,name),'utf8');assert.equal(bytes.includes('service-failed'),false);
 }
});

test('missing bundled service module reaches the desktop as an installation error', {timeout:20000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-missing-'));
 const child=launchService(process.execPath,fileURLToPath(new URL('./fixtures/desktop-service-loading.js',import.meta.url)),{...process.env,OBSERVANDA_FIXTURE_MISSING_MODULE:'1'}),reports=[];
 const ended=once(child,'close');child.stdout.resume();child.stderr.resume();
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await ended;await rm(root,{recursive:true,force:true});});
 child.on('message',value=>{
  if(value.type==='fixture-ready')child.send({type:'start',preferencesFile:path.join(root,'preferences.json')});
  if(value.type==='failed')reports.push(value);
 });
 assert.deepEqual(await ended,[1,null]);assert.equal(reports.length,1);
 assert.equal(reports[0].code,'INSTALL_FILE_MISSING');assert.match(reports[0].message,/installation file is missing/i);
 assert.ok(!reports[0].message.includes(root));
});
