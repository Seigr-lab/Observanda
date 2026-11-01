import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,cp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {LocalExport} from '../src/local-export.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-root-')),f=await encryptedFixture(directory,sampleNotebook()),output=path.join(directory,'output');await mkdir(output);
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-export-root-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const candidate={id:digest('synthetic edition'),reviewId:digest('synthetic review'),defaultPage:'index.html',files:new Map([['index.html',Buffer.from('Reviewed homepage')],['assets/detail.txt',Buffer.from('Reviewed detail')]])};
 const service=options=>{const value=new LocalExport(f.workspace,options);value.candidate=async()=>candidate;return value;};
 return {...f,directory,output,candidate,service,plan:()=>service().plan({directory:output,reviewId:candidate.reviewId})};
}
test('reviewed export refuses a substituted root even when it contains identical files',async t=>{
 const f=await fixture(t),plan=await f.plan(),original=path.join(f.directory,'original');assert.match((await f.service().get(plan.id)).directoryIdentity,/^\d+:\d+$/);
 await rename(f.output,original);await cp(original,f.output,{recursive:true});await writeFile(path.join(f.output,'unrelated'),'Keep');
 await assert.rejects(f.service().apply({id:plan.id,reviewed:true}),{code:'LOCAL_EXPORT_CHANGED'});assert.deepEqual(await readdir(f.output),['unrelated']);
 await assert.rejects(f.service().discard({id:plan.id}),{code:'LOCAL_EXPORT_CHANGED'});assert.equal(await readFile(path.join(f.output,'unrelated'),'utf8'),'Keep');
});
for(const phase of ['staged','ready','installed','committed'])test('root exchange at '+phase+' preserves replacement content and requires the reviewed root for recovery',async t=>{
 const f=await fixture(t),plan=await f.plan(),original=path.join(f.directory,'original');let changed=false;
 const service=f.service({checkpoint:async(step,name)=>{if(step===phase&&!changed&&(name===undefined||name==='index.html')){changed=true;await rename(f.output,original);await cp(original,f.output,{recursive:true});await writeFile(path.join(f.output,'unrelated'),'Keep');}}});
 await assert.rejects(service.apply({id:plan.id,reviewed:true}),{code:'LOCAL_EXPORT_CHANGED'});assert.equal(changed,true);const names=await readdir(f.output,{recursive:true});
 await assert.rejects(f.service().apply({id:plan.id,reviewed:true}),{code:'LOCAL_EXPORT_CHANGED'});assert.deepEqual(await readdir(f.output,{recursive:true}),names);assert.equal(await readFile(path.join(f.output,'unrelated'),'utf8'),'Keep');
 const replacement=path.join(f.directory,'replacement');await rename(f.output,replacement);await rename(original,f.output);
 assert.equal((await f.service().apply({id:plan.id,reviewed:true})).cleaned,true);assert.equal(await readFile(path.join(f.output,'index.html'),'utf8'),'Reviewed homepage');assert.equal(await readFile(path.join(replacement,'unrelated'),'utf8'),'Keep');
});
test('legacy planned review can bind on explicit application but unbound interrupted cleanup fails closed',async t=>{
 const f=await fixture(t),plan=await f.plan(),service=f.service(),saved=await service.get(plan.id);delete saved.directoryIdentity;
 await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/local-exports/'+plan.id+'.json',serialize(saved)));
 assert.equal((await service.apply({id:plan.id,reviewed:true})).cleaned,true);assert.match((await service.get(plan.id)).directoryIdentity,/^\d+:\d+$/);
 const next=await f.plan(),unbound=await service.get(next.id);delete unbound.directoryIdentity;unbound.state='staging';await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/local-exports/'+next.id+'.json',serialize(unbound)));
 await assert.rejects(service.apply({id:next.id,reviewed:true}),{code:'LOCAL_EXPORT_RECOVER'});await assert.rejects(service.discard({id:next.id}),{code:'LOCAL_EXPORT_RECOVER'});assert.equal(await readFile(path.join(f.output,'index.html'),'utf8'),'Reviewed homepage');
});
