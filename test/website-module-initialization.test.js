import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

test('website and storage indexes initialize directly without importing Workspace first',async()=>{
 for(const file of ['website-sites.js','object-index.js','record-block-store.js']){
  const url=new URL('../src/'+file,import.meta.url).href;
  const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(url)+');'],{windowsHide:true,timeout:15000});
  assert.equal(stdout,'');assert.equal(stderr,'');
 }
});
