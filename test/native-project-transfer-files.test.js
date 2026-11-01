import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {withNativeDestination} from '../src/native-destination.js';
import {withNativeProjectTransferFiles} from '../src/native-project-transfer-files.js';

const receipts='.observanda/project-transfer-files';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-native-owner-files-')),source={root:path.join(root,'source')},destination=path.join(root,'destination');await mkdir(path.join(source.root,'.observanda/evidence'),{recursive:true});
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-native-owner-files-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {root,source,destination,run:operation=>withNativeDestination(destination,async admitted=>{await admitted.admit({prepare:true});await admitted.ensure(receipts+'/staging');return withNativeProjectTransferFiles(source,admitted,receipts,operation);})};
}

test('native owner files stream across bounded blocks and publish the measured source checksum',async t=>{
 const f=await fixture(t),relative='.observanda/evidence/sample.bin',bytes=Buffer.alloc(3*1024*1024+37,83),sha256=createHash('sha256').update(bytes).digest('hex');await writeFile(path.join(f.source.root,relative),bytes);
 await f.run(async files=>{const copied=await files.copy({path:relative,bytes:bytes.length});assert.deepEqual(copied,{bytes:bytes.length,sha256});assert.equal((await files.stageHash(relative)).sha256,sha256);await files.publish(relative,copied);assert.equal((await files.hash(relative)).sha256,sha256);});
 assert.deepEqual(await readFile(path.join(f.destination,relative)),bytes);assert.deepEqual(await readdir(path.join(f.destination,receipts,'staging')),[]);
});

test('native owner publication stays anchored when its nested parent is exchanged for a link',async t=>{
 const f=await fixture(t),relative='.observanda/evidence/sample.bin',bytes=Buffer.from('Reviewed bytes'),outside=path.join(f.root,'outside'),retained=path.join(f.root,'retained');await writeFile(path.join(f.source.root,relative),bytes);await mkdir(outside);await writeFile(path.join(outside,'sample.bin'),'Unrelated');
 await assert.rejects(f.run(async files=>{await files.hash(relative);const copied=await files.copy({path:relative,bytes:bytes.length});await rename(path.join(f.destination,'.observanda/evidence'),retained);await symlink(outside,path.join(f.destination,'.observanda/evidence'),process.platform==='win32'?'junction':'dir');await files.publish(relative,copied);}),error=>['UNSAFE','STORAGE_COPY'].includes(error.code));
 assert.equal(await readFile(path.join(outside,'sample.bin'),'utf8'),'Unrelated');assert.deepEqual(await readdir(outside),['sample.bin']);assert.deepEqual(await readFile(path.join(retained,'sample.bin')),bytes);
});

test('native owner copies reject a changed declared source size without publishing a stage',async t=>{
 const f=await fixture(t),relative='.observanda/evidence/sample.bin';await writeFile(path.join(f.source.root,relative),'Changed source size');
 await f.run(async files=>{await assert.rejects(files.copy({path:relative,bytes:1}),{code:'STORAGE_COPY'});assert.equal(await files.stageHash(relative),null);});
 assert.deepEqual(await readdir(path.join(f.destination,receipts,'staging')),[]);
});
