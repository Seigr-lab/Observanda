import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('native scientific library loads only on first calculation and preserves exact and approximate results',async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {createRequire} from 'node:module';
  const require=createRequire(import.meta.url),loaded=()=>Object.keys(require.cache).some(name=>/[\\\\/]mathjs[\\\\/]/.test(name));
  const native=await import('./src/tools/math-node.js');assert.equal(loaded(),false);
  const first=native.calculateDetailed('1/3');assert.equal(loaded(),true);assert.deepEqual(first.exact,{numerator:'1',denominator:'3'});
  const browser=await import('./src/tools/math.js');
  for(const expression of ['1/3','sqrt(2)','sin(0)','2^64'])assert.deepEqual(native.calculateDetailed(expression),browser.calculateDetailed(expression));
  assert.equal(loaded(),true);console.log('passed');
 `],{cwd:process.cwd(),windowsHide:true});assert.equal(stdout.trim(),'passed');
});
