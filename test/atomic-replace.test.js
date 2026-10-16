import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {atomicReplace} from '../src/atomic-replace.js';
test('temporary Windows sharing failures retry without removing the previous file',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-atomic-')),source=path.join(root,'new'),target=path.join(root,'current');await writeFile(source,'new bytes');await writeFile(target,'old bytes');let attempts=0;const waits=[];
 await atomicReplace(source,target,{platform:'win32',wait:async ms=>{waits.push(ms);assert.equal(await readFile(target,'utf8'),'old bytes');},replace:async(a,b)=>{if(++attempts<3)throw Object.assign(new Error(),{code:'EPERM'});await rename(a,b);}});assert.deepEqual(waits,[20,40]);assert.equal(await readFile(target,'utf8'),'new bytes');
});
test('persistent failures are bounded and non-Windows failures are returned immediately',async()=>{
 for(const [platform,total] of [['win32',7],['linux',1]]){let attempts=0;await assert.rejects(atomicReplace('source','target',{platform,wait:async()=>{},replace:async()=>{attempts++;throw Object.assign(new Error('denied'),{code:'EACCES'});}}),/denied/);assert.equal(attempts,total);}
});
