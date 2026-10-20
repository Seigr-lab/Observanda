import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

// Qualifies retained edition growth independently of authoring. Each scale owns
// a fresh, fixed-heap process and inherits only the runner's isolated database.
// The fixture contains the one capture/render/verification/export scenario.
for(const count of [65,650])test('page-at-a-time retained edition handles '+count+' substantive originals',async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-edition-growth-'));let failure;
 try{
  const running=promisify(execFile)(process.execPath,['--max-old-space-size=192','--max-semi-space-size=8',fileURLToPath(new URL('./fixtures/publication-growth.js',import.meta.url)),String(count),directory],{cwd:fileURLToPath(new URL('..',import.meta.url)),windowsHide:true,timeout:300000,maxBuffer:1024*1024,signal:t.signal});
  running.child.stdout.pipe(process.stdout,{end:false});running.child.stderr.pipe(process.stderr,{end:false});
  const {stdout}=await running,measurement=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(measurement.records,count);assert.ok(measurement.heapLimit<256*1024*1024);
  t.diagnostic(JSON.stringify(measurement));
 }catch(error){failure=error;throw error;}finally{
  assert.equal(path.dirname(path.resolve(directory)),parent);assert.ok(path.basename(directory).startsWith('observanda-edition-growth-'));
  try{await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch(error){if(failure)throw new AggregateError([failure,error],'Growth scenario and temporary cleanup failed');throw error;}
 }
});
