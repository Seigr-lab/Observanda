import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,readFile,writeFile,rm,stat,mkdir,symlink} from 'node:fs/promises';
import {randomBytes,randomUUID as id} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {contentBuffer} from '../src/file-content.js';
import {retainPublicationMedia,publicationInputMedia,removePublicationMedia} from '../src/publication-input-media.js';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-edition-assets-'));
 t.after(async()=>{const target=path.resolve(root),parent=path.resolve(os.tmpdir());assert.equal(path.dirname(target),parent);assert.ok(path.basename(target).startsWith('observanda-edition-assets-'));await rm(target,{recursive:true,force:true});});
 const vault={id:id(),key:randomBytes(32)},workspace=new Workspace(root,vault),jobId=id(),host=id(),foreign=id(),assetId=id(),bytes=Buffer.concat([Buffer.from('RIFF'),randomBytes(8192)]);
 const asset={id:assetId,kind:'audio',extension:'wav',mime:'audio/wav',bytes},source={id:jobId,metadata:{id:host},records:[{sourceWorkspaceId:foreign,media:[{id:assetId}]}]};
 return {root,vault,workspace,jobId,assetId,asset,source,bytes};
}
test('retained foreign assets reopen with only the edition key and authenticate before returning bytes',async t=>{
 const f=await fixture(t),rows=await retainPublicationMedia(f.workspace,f.jobId,[f.asset]);f.source.retainedMedia=rows;
 assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes(f.root));const file=path.join(f.root,'.observanda','release-input-media',f.jobId,f.assetId+'.blob'),stored=await readFile(file);assert.notDeepEqual(stored,f.bytes);assert.ok(!stored.includes(f.bytes.subarray(0,40)));
 const reopened=new Workspace(f.root,{...f.vault,key:Buffer.from(f.vault.key)}),media=await publicationInputMedia(reopened,f.source).get(f.assetId);assert.deepEqual(await contentBuffer(media.bytes),f.bytes);
 reopened.vault.key=null;await assert.rejects(contentBuffer(media.bytes),{code:'ACCESS_LOCKED'});reopened.vault.key=Buffer.from(f.vault.key);
 stored[stored.length-1]^=1;await writeFile(file,stored);let leaked=false;await assert.rejects(async()=>{for await(const chunk of media.bytes.read()){leaked=true;void chunk;}},{code:'ENCRYPTION_DAMAGED'});assert.equal(leaked,false);
 await removePublicationMedia(f.workspace,f.jobId);await assert.rejects(stat(file),{code:'ENOENT'});
});
test('missing, duplicate or malformed retained media cannot fall back to another database',async t=>{
 const f=await fixture(t);assert.throws(()=>publicationInputMedia(f.workspace,f.source),{code:'JOB_DAMAGED'});
 const rows=await retainPublicationMedia(f.workspace,f.jobId,[f.asset]);for(const retainedMedia of [[...rows,...rows],[{...rows[0],id:'../outside'}],[{...rows[0],size:-1}],[{...rows[0],header:'zz'}]])assert.throws(()=>publicationInputMedia(f.workspace,{...f.source,retainedMedia}),{code:'JOB_DAMAGED'});
 await removePublicationMedia(f.workspace,f.jobId);
});
test('failed or cancelled pinning removes only its unpublished asset files',async t=>{
 const f=await fixture(t),unrelated=path.join(f.root,'retained-original');await writeFile(unrelated,f.bytes);
 async function* broken(){yield f.asset;throw new Error('source unavailable');}
 await assert.rejects(retainPublicationMedia(f.workspace,f.jobId,broken()),/source unavailable/);await assert.rejects(stat(path.join(f.root,'.observanda','release-input-media',f.jobId)),{code:'ENOENT'});assert.deepEqual(await readFile(unrelated),f.bytes);
 const controller=new AbortController();async function* cancelled(){yield f.asset;controller.abort();yield {...f.asset,id:id()};}
 await assert.rejects(retainPublicationMedia(f.workspace,f.jobId,cancelled(),{signal:controller.signal}),{name:'AbortError'});await assert.rejects(stat(path.join(f.root,'.observanda','release-input-media',f.jobId)),{code:'ENOENT'});assert.deepEqual(await readFile(unrelated),f.bytes);
});
test('a replaced media parent cannot redirect edition reads or cleanup',async t=>{
 const f=await fixture(t),outside=path.join(f.root,'other-owner'),parent=path.join(f.root,'.observanda');await mkdir(outside);await writeFile(path.join(outside,'sentinel'),f.bytes);await symlink(outside,parent,process.platform==='win32'?'junction':'dir');
 await assert.rejects(retainPublicationMedia(f.workspace,f.jobId,[f.asset]),{code:'UNSAFE'});await assert.rejects(removePublicationMedia(f.workspace,f.jobId),{code:'UNSAFE'});assert.deepEqual(await readFile(path.join(outside,'sentinel')),f.bytes);
});
