import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('record and metadata admission measure exact oversized content without serialized copies',async t=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=48','--max-semi-space-size=4','test/fixtures/measure-large-record.js'],{cwd:process.cwd(),timeout:120000,windowsHide:true});
 const result=JSON.parse(stdout.trim());assert.ok(result.measured>130*1024*1024);assert.ok(result.heapLimit<64*1024*1024);assert.ok(result.heapMiB<60);t.diagnostic(stdout.trim());
});
