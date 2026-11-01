import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openQueryCacheFiles,verifiedQueryCacheNamespace} from '../src/query-cache-files.js';
import {QueryResultSort,QueryCachePressure} from '../src/query-result-sort.js';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-query-cache-'));await mkdir(path.join(root,'.observanda'));const workspace={root,vault:{id:randomUUID(),key:randomBytes(32)},cleanup:[]};t.after(async()=>{const results=await Promise.allSettled(workspace.cleanup.map(value=>value.close()));workspace.vault.key.fill(0);await rm(root,{recursive:true,force:true});for(const result of results)if(result.status==='rejected')throw result.reason;});return workspace;}
test('native query cache retains independent leases and removes only its authenticated fixed files',async t=>{
 const workspace=await fixture(t),first=await openQueryCacheFiles(workspace);workspace.cleanup.push(first);const sort=new QueryResultSort(first,randomBytes(32),first.id),rows=Array.from({length:1000},(_,i)=>({id:String(i),title:'PRIVATE_OBSERVATION_'+String(1000-i).padStart(4,'0')})),order=(a,b)=>a.title<b.title?-1:a.title>b.title?1:0;
 const receipt=await sort.build(rows,order);await first.finish();assert.deepEqual(await sort.page(receipt,128,25),[...rows].sort(order).slice(128,153));
 const second=await openQueryCacheFiles(workspace);workspace.cleanup.push(second);assert.equal(await verifiedQueryCacheNamespace(workspace.root,workspace.vault),true);await first.assertNamed();
 const directory=path.join(workspace.root,'.observanda','query-cache',first.id);for(const file of await readdir(directory))if(file!=='lease')assert.equal((await readFile(path.join(directory,file))).includes(Buffer.from('PRIVATE_OBSERVATION')),false);
 await second.close();await first.close();assert.deepEqual((await readdir(path.join(workspace.root,'.observanda','query-cache'))).sort(),['admission','namespace']);
});
test('unproven cache names and altered ownership are preserved and never excluded from inventories',async t=>{
 const workspace=await fixture(t),directory=path.join(workspace.root,'.observanda','query-cache');await mkdir(directory);await writeFile(path.join(directory,'unrelated'),'preserve this');
 await assert.rejects(openQueryCacheFiles(workspace),QueryCachePressure);assert.equal(await readFile(path.join(directory,'unrelated'),'utf8'),'preserve this');assert.equal(await verifiedQueryCacheNamespace(workspace.root,workspace.vault),false);
 const owned=await fixture(t),files=await openQueryCacheFiles(owned);owned.cleanup.push(files);const file=path.join(owned.root,'.observanda','query-cache',files.id,'owner'),before=await readFile(file),changed=Buffer.from(before);changed[changed.length-1]^=1;await writeFile(file,changed);
 assert.equal(await verifiedQueryCacheNamespace(owned.root,owned.vault),false);await assert.rejects(openQueryCacheFiles(owned),QueryCachePressure);assert.deepEqual(await readFile(file),changed);await writeFile(file,before);await files.close();
});

test('a crashed process releases its lease and a current vault reclaims only the proved abandoned cache',async t=>{
 const workspace=await fixture(t);workspace.vault.key.fill(7);
 const script="import {openQueryCacheFiles} from './src/query-cache-files.js';const workspace={root:process.argv[1],vault:{id:process.argv[2],key:Buffer.alloc(32,7)}};const cache=await openQueryCacheFiles(workspace);await cache.write('a.data',0,Buffer.alloc(16384,11));console.log(cache.id);process.exit(0);";
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,workspace.root,workspace.vault.id],{cwd:process.cwd(),timeout:20000,maxBuffer:2048,windowsHide:true}),abandoned=stdout.trim();assert.match(abandoned,/^[a-f0-9-]{36}$/);
 let replacement;
 for(let attempt=0;attempt<10;attempt++){
  replacement=await openQueryCacheFiles(workspace);workspace.cleanup.push(replacement);if(!(await readdir(path.join(workspace.root,'.observanda','query-cache'))).includes(abandoned))break;await replacement.close();replacement=null;await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.ok(replacement);assert.equal((await readdir(path.join(workspace.root,'.observanda','query-cache'))).includes(abandoned),false);await replacement.close();
});
test('substituted internal directory cannot redirect cache reads, writes or cleanup',async t=>{
 const workspace=await fixture(t),files=await openQueryCacheFiles(workspace);workspace.cleanup.push(files);await files.write('a.data',0,Buffer.from('original encrypted bytes'));
 const internal=path.join(workspace.root,'.observanda'),retained=path.join(workspace.root,'.observanda-retained');
 if(process.platform==='win32'){await assert.rejects(rename(internal,retained),error=>['EPERM','EACCES','EBUSY'].includes(error.code));await files.assertNamed();assert.equal((await files.read('a.data',0,24)).toString(),'original encrypted bytes');await files.close();t.diagnostic('The retained exclusive lease blocks ancestor replacement on Windows.');return;}
 await rename(internal,retained);const external=path.join(internal,'query-cache',files.id);await mkdir(external,{recursive:true});await writeFile(path.join(external,'a.data'),'external retained data');
 await assert.rejects(files.assertNamed(),QueryCachePressure);assert.equal((await files.read('a.data',0,24)).toString(),'original encrypted bytes');await files.write('a.data',0,Buffer.from('original encrypted bytes'));await files.close();
 assert.equal(await readFile(path.join(external,'a.data'),'utf8'),'external retained data');assert.equal(await verifiedQueryCacheNamespace(workspace.root,workspace.vault),false);assert.equal((await readdir(path.join(retained,'query-cache'))).includes(files.id),false);
});
