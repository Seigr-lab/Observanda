import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {withPublicationCapture} from '../src/publication-capture.js';

for(const cancel of [false,true])test('first publication setup behind a retained reader: '+(cancel?'cancel':'resume'),{timeout:60000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-capture-admission-')),f=await encryptedFixture(directory,sampleNotebook()),reader=await f.workspace.openCatalogue();
 const controller=new AbortController(),contended=Promise.withResolvers(),withLock=f.workspace.withLock;let pending,entered=0,settled=false;
 t.mock.method(f.workspace,'withLock',async function(...args){try{return await withLock.apply(this,args);}catch(error){if(error.code==='LOCKED')contended.resolve();throw error;}});
 try{
  await reader.run('BEGIN');await reader.get('SELECT * FROM catalogue_format');
  pending=withPublicationCapture(f.workspace,async(_workspace,_id,finish)=>{entered++;return finish(async()=>{});},{signal:controller.signal}).finally(()=>{settled=true;});pending.catch(()=>{});
  await Promise.race([contended.promise,pending.then(()=>assert.fail('Expected schema admission contention'))]);
  await delay(400);assert.equal(settled,false,'Brief reader contention must not fail preparation');assert.equal(entered,0);
  if(cancel){controller.abort();await assert.rejects(pending,{name:'AbortError'});}
  await reader.run('ROLLBACK');await reader.close();
  if(!cancel)await pending;
  assert.equal(entered,cancel?0:1,'Only admission may retry; the capture callback runs at most once');
  assert.deepEqual(await f.workspace.listMetadata('.observanda/release-captures'),[]);
 }finally{controller.abort();await reader.close();await pending?.catch(()=>{});clearVault(f.vault);assert.equal(path.dirname(directory),parent);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
