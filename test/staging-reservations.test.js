import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,realpath,readFile,rename,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {withStagingAuthority,recoverStaging,verifiedStagingReservationNamespace} from '../src/staging-reservations.js';
import {diskCapacity} from '../src/disk-capacity.js';
import {STAGING_FREE_BYTES} from '../src/staging-reservation-model.js';
import {Workspace} from '../src/storage.js';
import {writeContent,FileContent,contentBuffer} from '../src/file-content.js';
import {copyPlan} from '../src/locations.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {temporaryStreamName} from '../src/storage-temporary.js';
import {writeFilePart} from '../src/segmented-file-io.js';

async function fixture(t){const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-staging-ledger-'));await mkdir(path.join(root,'.observanda'));const metadata=new Map(),workspace={root,vault:{id:randomUUID(),key:randomBytes(32)},storageKind:async()=>'catalogue',readMetadata:async name=>metadata.get(name)??null,metadataPage:async prefix=>({items:[...metadata].filter(([name])=>name.startsWith(prefix+'/')).slice(0,32).map(([name,text])=>({name:name.slice(prefix.length+1),text}))}),removeMetadata:async name=>metadata.delete(name)};
 t.after(async()=>{await closeIdleMutationFiles();workspace.vault.key?.fill(0);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-staging-ledger-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {workspace,metadata};}
const input=(values={})=>({id:randomUUID(),principalId:randomUUID(),ownerId:randomUUID(),grantGeneration:1,expectedBytes:1000,entries:1,expiresAt:Date.now()+60000,...values});
async function staged(authority,claim,bytes,{publish=true,index=0}={}){
 return authority.scope.member(path.join(authority.workspace.root,'.observanda/collaboration/staging',claim.id,index+'.blob'),async(directory,name)=>{
  const temporary=temporaryStreamName(),ticket=await claim.capacity({directory,temporary,name,storedBytes:bytes.length}),file=await directory.file(temporary,{mode:'exclusive'}),identity=file.identity;
  try{await ticket.created(file);await ticket.write(bytes.length,()=>writeFilePart(file,bytes,0));await file.sync();await file.close();if(publish){await ticket.beforePublish();await directory.rename(temporary,directory,name,{identity});}return {temporary,identity};}finally{await file.close();await ticket.release();}
 });
}
test('durable claims count only remaining bytes and recover abandoned registered payloads',async t=>{
 const f=await fixture(t),request=input();await withStagingAuthority(f.workspace,async authority=>{const claim=await authority.reserve(request);assert.deepEqual(await authority.status(),{active:1,remainingBytes:1000,writtenBytes:0});await staged(authority,claim,Buffer.alloc(400,1));assert.deepEqual(await authority.status(),{active:1,remainingBytes:600,writtenBytes:400});await assert.rejects(authority.handoff(),{code:'LOCKED'});await claim.close();});
 await withStagingAuthority(f.workspace,async authority=>{await authority.recover();assert.deepEqual(await authority.status(),{active:0,remainingBytes:0,writtenBytes:0});});await assert.rejects(readFile(path.join(f.workspace.root,'.observanda/collaboration/staging',request.id,'0.blob')),{code:'ENOENT'});
});
test('a committed database head protects payload across interrupted reservation finalization',async t=>{
 const f=await fixture(t),request=input(),body=Buffer.from('committed research');await withStagingAuthority(f.workspace,async authority=>{const claim=await authority.reserve(request);await staged(authority,claim,body);await claim.preparing();f.metadata.set('.observanda/collaboration/staging/'+claim.id+'/head.json','{"committed":true}');await claim.close();});
 await withStagingAuthority(f.workspace,async authority=>{while(await authority.recover()){}await authority.handoff();assert.equal((await authority.status()).active,0);});assert.deepEqual(await readFile(path.join(f.workspace.root,'.observanda/collaboration/staging',request.id,'0.blob')),body);
});
test('an authenticated stage never grants cleanup permission for an unrecorded file',async t=>{
 const f=await fixture(t),request=input();await withStagingAuthority(f.workspace,async authority=>{const claim=await authority.reserve(request);await staged(authority,claim,Buffer.from('owned stage'));await authority.scope.write(path.join(f.workspace.root,'.observanda/collaboration/staging',claim.id,'unrelated'),'preserved');await claim.close();});
 await assert.rejects(withStagingAuthority(f.workspace,authority=>authority.recover()),{code:'COLLABORATION_DAMAGED'});assert.equal(await readFile(path.join(f.workspace.root,'.observanda/collaboration/staging',request.id,'unrelated'),'utf8'),'preserved');
});

test('cleanup rejects a substituted file even when its size and bytes match',async t=>{
 const f=await fixture(t),request=input(),body=Buffer.from('same bytes do not prove ownership');await withStagingAuthority(f.workspace,async authority=>{const claim=await authority.reserve(request);await staged(authority,claim,body);await claim.close();});
 const file=path.join(f.workspace.root,'.observanda/collaboration/staging',request.id,'0.blob'),original=path.join(f.workspace.root,'preserved-original');await rename(file,original);await writeFile(file,body);
 await assert.rejects(withStagingAuthority(f.workspace,authority=>authority.recover()),{code:'COLLABORATION_DAMAGED'});assert.deepEqual(await readFile(file),body);assert.deepEqual(await readFile(original),body);
});

test('aggregate admission subtracts written bytes once and expiry never defeats a live lease',async t=>{
 const f=await fixture(t);let available=BigInt(STAGING_FREE_BYTES+1500);t.mock.method(diskCapacity,'probe',async()=>({id:'isolated-staging-capacity',available}));
 await withStagingAuthority(f.workspace,async authority=>{
  const first=await authority.reserve(input());await assert.rejects(authority.reserve(input()),{code:'STORAGE_FULL'});
  await staged(authority,first,Buffer.alloc(400));available-=400n;
  const second=await authority.reserve(input({expectedBytes:500}));assert.equal((await authority.status()).remainingBytes,1100);
  const now=t.mock.method(Date,'now',()=>first.claim.expiresAt+1);try{await assert.rejects(first.check(),{code:'COLLABORATION_EXPIRED'});assert.equal(await authority.recover(),false);await assert.rejects(authority.recover({rejectActive:true}),{code:'LOCKED'});}finally{now.mock.restore();}
  await first.close();await second.close();while(await authority.recover()){}assert.equal((await authority.status()).active,0);
 });
});

test('later ordinary encrypted writes respect the owning authority reservation',async t=>{
 const f=await fixture(t),workspace=new Workspace(f.workspace.root,f.workspace.vault),file=path.join(workspace.root,'ordinary'),bytes=Buffer.alloc(400,9);t.mock.method(diskCapacity,'probe',async()=>({id:'same-authority-device',available:BigInt(STAGING_FREE_BYTES+1200)}));
 await withStagingAuthority(f.workspace,async authority=>{const claim=await authority.reserve(input());await assert.rejects(writeContent(workspace,file,[bytes]),{code:'STORAGE_FULL'});assert.equal(diskCapacity.stats().active,0);assert.equal((await authority.status()).remainingBytes,1000);await claim.close();while(await authority.recover()){};});
 const saved=await writeContent(workspace,file,[bytes]);assert.deepEqual(await contentBuffer(new FileContent(workspace,file,saved.size,saved.sha256)),bytes);assert.equal(diskCapacity.stats().active,0);
 await assert.rejects(copyPlan(workspace.root,path.join(workspace.root,'not-used')),{code:'ACCESS_LOCKED'});
});

test('recovery releases the writer between bounded file and metadata slices',async t=>{
 const f=await fixture(t),request=input({entries:65,expectedBytes:1000}),between=[];let writes=0,held=false,turns=0;
 f.workspace.withLock=async operation=>{assert.equal(held,false);held=true;writes++;try{return await operation();}finally{held=false;between.push(new Promise(resolve=>setImmediate(()=>{assert.equal(held,false);turns++;resolve();})));}};
 await withStagingAuthority(f.workspace,async authority=>{const claim=await authority.reserve(request);for(let index=0;index<65;index++){await staged(authority,claim,Buffer.from([index]),{index});f.metadata.set('.observanda/collaboration/staging/'+claim.id+'/items/'+index+'.json','{}');}await claim.close();});
 await recoverStaging(f.workspace);await Promise.all(between);assert.ok(writes>=6);assert.equal(turns,writes);assert.equal(f.metadata.size,0);assert.equal(await verifiedStagingReservationNamespace(f.workspace.root,f.workspace.vault),true);
});

test('a killed writer leaves authenticated staged bytes recoverable by another process',{timeout:15000},async t=>{
 const f=await fixture(t),request=input(),child=spawn(process.execPath,['test/fixtures/staging-reservation-worker.js'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',part=>{stderr+=part;});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});const exited=once(child,'exit');child.stdin.end(JSON.stringify({root:f.workspace.root,id:f.workspace.vault.id,key:f.workspace.vault.key.toString('base64'),request}));
 const ready=await Promise.race([once(child.stdout,'data').then(([data])=>data.toString()),exited.then(()=>{throw new Error('Staging worker failed: '+stderr);})]);assert.equal(ready,'ready');
 const probe=t.mock.method(diskCapacity,'probe',async()=>({id:'isolated-cross-process-capacity',available:BigInt(STAGING_FREE_BYTES+1000)}));
 await withStagingAuthority(f.workspace,async authority=>{assert.equal((await authority.status()).active,1);assert.equal(await authority.recover(),false);await assert.rejects(authority.reserve(input({expectedBytes:1})),{code:'STORAGE_FULL'});});probe.mock.restore();child.kill();await exited;
 const deadline=Date.now()+5000;let active=1;while(active&&Date.now()<deadline){await withStagingAuthority(f.workspace,async authority=>{while(await authority.recover()){}active=(await authority.status()).active;});if(active)await delay(20);}
 assert.equal(active,0);await assert.rejects(readFile(path.join(f.workspace.root,'.observanda/collaboration/staging',request.id,'0.blob')),{code:'ENOENT'});
});
