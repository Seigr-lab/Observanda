import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink,rm,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {withNativeWorkspaceCopy} from '../src/native-workspace-copy.js';
import {OperationalDiagnostics,withDiagnostics,diagnostic} from '../src/operational-diagnostics.js';
const windows={skip:!['win32','linux','darwin'].includes(process.platform)},file=(name,data)=>({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-copy-')),source=path.join(parent,'source'),target=path.join(parent,'target'),outside=path.join(parent,'outside');for(const root of [source,target,outside])await mkdir(root);
 await writeFile(path.join(outside,'sentinel'),'keep');t.after(async()=>{assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-native-copy-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {parent,source,target,outside};
}
test('native workspace copy streams nested files and resumes a completed file without reading its source again',windows,async t=>{
 const f=await fixture(t),data=Buffer.alloc(12*1024*1024+13,37),item=file('nested/original.bin',data);await mkdir(path.join(f.source,'nested'));await writeFile(path.join(f.source,item.path),data);
 await mkdir(path.join(f.target,'nested'));await writeFile(path.join(f.target,'nested','.stream-recovery'),'partial');
 const sink=new OperationalDiagnostics();await withDiagnostics(sink,async()=>{await withNativeWorkspaceCopy(f.source,f.target,async copy=>{
  await copy(item,{temporary:'.stream-recovery'});assert.deepEqual(await readFile(path.join(f.target,item.path)),data);
  await unlink(path.join(f.source,item.path));await copy(item,{temporary:'.stream-recovery'});
  assert.deepEqual(await readdir(path.join(f.target,'nested')),['original.bin']);
  await assert.rejects(copy({...item,sha256:'0'.repeat(64)},{temporary:'.stream-recovery'}),{code:'STORAGE_COPY'});
 });diagnostic('request',{route:'storage',method:'POST'});});
 assert.equal((await sink.snapshot()).entries.at(-1).nativeDirectoryRequests,4);await sink.close();assert.equal(await readFile(path.join(f.outside,'sentinel'),'utf8'),'keep');
});
test('native workspace copying cannot redirect reads or writes through replaced source and destination ancestors',windows,async t=>{
 const f=await fixture(t),data=Buffer.from('reviewed source'),item=file('original.bin',data);await writeFile(path.join(f.source,item.path),data);await writeFile(path.join(f.outside,item.path),'outside');
 await withNativeWorkspaceCopy(f.source,f.target,async copy=>{
  await rename(f.source,path.join(f.parent,'original-source'));await symlink(f.outside,f.source,'junction');
  await rename(f.target,path.join(f.parent,'original-target'));await symlink(f.outside,f.target,'junction');
  await copy(item);
 });assert.deepEqual(await readFile(path.join(f.parent,'original-target',item.path)),data);assert.equal(await readFile(path.join(f.outside,item.path),'utf8'),'outside');
});
test('native workspace copying rejects changed source bytes and preserves unrelated destination files',windows,async t=>{
 const f=await fixture(t),data=Buffer.from('expected source'),item=file('original.bin',data);await writeFile(path.join(f.source,item.path),'different bytes');await writeFile(path.join(f.target,'keep'),'unrelated');
 await assert.rejects(withNativeWorkspaceCopy(f.source,f.target,copy=>copy(item)),{code:'STORAGE_COPY'});assert.deepEqual(await readdir(f.target),['keep']);
});
test('reused parent handles stay on their admitted directories when both cached paths become junctions',windows,async t=>{
 const f=await fixture(t),data=Buffer.from('reviewed source');await mkdir(path.join(f.source,'nested'));for(const name of ['one','two'])await writeFile(path.join(f.source,'nested',name),data);
 await writeFile(path.join(f.outside,'two'),'outside');
 await withNativeWorkspaceCopy(f.source,f.target,async copy=>{
  await copy(file('nested/one',data));
  for(const root of [f.source,f.target]){await rename(path.join(root,'nested'),path.join(root,'original'));await symlink(f.outside,path.join(root,'nested'),'junction');}
  await copy(file('nested/two',data));
 });assert.deepEqual(await readFile(path.join(f.target,'original','two')),data);assert.equal(await readFile(path.join(f.outside,'two'),'utf8'),'outside');
});
