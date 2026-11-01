import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {withNativeDestination} from '../src/native-destination.js';
import {atomicWrite,privateDirectory} from '../src/storage.js';
import {prepareCopyDestination} from '../src/locations.js';
import {withNativeWorkspaceCopy} from '../src/native-workspace-copy.js';
import {createHash} from 'node:crypto';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-destination-')),destination=path.join(root,'destination'),outside=path.join(root,'outside');await mkdir(outside);await writeFile(path.join(outside,'keep'),'unrelated');
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-destination-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {root,destination,outside};
}
test('destination claims are exclusive and preserve occupied folders',async t=>{
 const f=await fixture(t);await withNativeDestination(f.destination,async scope=>{
  const claim=await prepareCopyDestination(f.destination);assert.equal(claim.destinationIdentity,scope.identity);assert.equal(claim.internalIdentity,scope.internalIdentity);
  await assert.rejects(scope.directory.directory('.observanda',{create:true,exclusive:true}),{code:'EEXIST'});
  await assert.rejects(prepareCopyDestination(f.destination),{code:'EXISTS'});
 });assert.equal(await readFile(path.join(f.destination,'.observanda/copy-in-progress'),'utf8'),'incomplete\n');
 await assert.rejects(prepareCopyDestination(f.outside),{code:'EXISTS'});assert.deepEqual(await readdir(f.outside),['keep']);
});
for(const internal of [false,true])test(`scoped metadata remains anchored after ${internal?'internal':'root'} directory replacement`,{skip:!internal&&process.platform==='win32'?'NTFS blocks root rename with the retained internal directory open':false},async t=>{
 const f=await fixture(t),moved=path.join(f.root,'retained');
 await withNativeDestination(f.destination,async scope=>{
  await prepareCopyDestination(f.destination);const replaced=internal?path.join(f.destination,'.observanda'):f.destination;await rename(replaced,moved);await symlink(f.outside,replaced,'junction');
  await privateDirectory(f.destination,'.observanda/nested');await atomicWrite(path.join(f.destination,'.observanda/nested/value'),'retained metadata');
  assert.equal(await scope.read(path.join(f.destination,'.observanda/nested/value'),{encoding:'utf8'}),'retained metadata');
  await scope.remove(path.join(f.destination,'.observanda/copy-in-progress'));
  await assert.rejects(scope.assertNamed(),error=>['UNSAFE','STORAGE_COPY'].includes(error.code));
 });
 assert.deepEqual(await readdir(f.outside),['keep']);assert.equal(await readFile(path.join(moved,internal?'nested/value':'.observanda/nested/value'),'utf8'),'retained metadata');
});
test('Windows retains the root while its internal directory is open',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);await withNativeDestination(f.destination,async scope=>{await prepareCopyDestination(f.destination);await assert.rejects(rename(f.destination,path.join(f.root,'retained')),error=>['EPERM','EACCES','EBUSY'].includes(error.code));await scope.assertNamed();assert.equal(await privateDirectory(f.destination,'.'),f.destination);});
});
test('reopening a destination checks both saved directory identities',async t=>{
 const f=await fixture(t),claim=await prepareCopyDestination(f.destination),old=path.join(f.root,'original');await rename(f.destination,old);await mkdir(path.join(f.destination,'.observanda'),{recursive:true});
 await assert.rejects(withNativeDestination(f.destination,scope=>scope.admit({identity:claim.destinationIdentity,internalIdentity:claim.internalIdentity})),{code:'STORAGE_COPY'});
 assert.deepEqual(await readdir(path.join(f.destination,'.observanda')),[]);
});

test('metadata publication refuses a substituted temporary file',async t=>{
 const f=await fixture(t);await withNativeDestination(f.destination,async scope=>{
  await prepareCopyDestination(f.destination);const target=path.join(f.destination,'.observanda/value');await atomicWrite(target,'previous');
  const original=scope.internalDirectory.file.bind(scope.internalDirectory);let injected=false;
  t.mock.method(scope.internalDirectory,'file',async(name,options)=>{const handle=await original(name,options);if(options?.mode==='exclusive'&&!injected){const close=handle.close.bind(handle);handle.close=async()=>{await close();if(!injected){injected=true;await rename(path.join(f.destination,'.observanda',name),path.join(f.root,'original-write'));await writeFile(path.join(f.destination,'.observanda',name),'substitution');}};}return handle;});
  await assert.rejects(atomicWrite(target,'new bytes'),{code:'CONFLICT'});assert.equal(await readFile(target,'utf8'),'previous');assert.equal(await readFile(path.join(f.root,'original-write'),'utf8'),'new bytes');
 });
});

test('destination preparation rejects unrelated content inserted during its claim',async t=>{
 const f=await fixture(t);await withNativeDestination(f.destination,async scope=>{
  const write=scope.write.bind(scope);t.mock.method(scope,'write',async(...args)=>{await writeFile(path.join(f.destination,'unrelated'),'preserve');return write(...args);});
  await assert.rejects(prepareCopyDestination(f.destination),{code:'EXISTS'});assert.equal(await readFile(path.join(f.destination,'unrelated'),'utf8'),'preserve');
 });
});
test('nested owner file copies do not use the containing workspace as their output root',async t=>{
 const f=await fixture(t),source=path.join(f.root,'source'),bytes=Buffer.from('nested owner');await mkdir(source);await writeFile(path.join(source,'value'),bytes);
 await withNativeDestination(f.destination,async scope=>{
  await prepareCopyDestination(f.destination);await scope.ensure('Project/.observanda');
  await withNativeWorkspaceCopy(source,path.join(f.destination,'Project'),copy=>copy({path:'value',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
  assert.equal(await readFile(path.join(f.destination,'Project/value'),'utf8'),'nested owner');assert.deepEqual((await readdir(f.destination)).sort(),['.observanda','Project']);
 });
});
