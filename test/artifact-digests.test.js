import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,writeContent} from '../src/file-content.js';
import {withOperationProgress} from '../src/operation-progress.js';
import {artifactDigest} from '../src/artifact-digests.js';
import {ARTIFACT_DIGESTS,normalizedDigest,validExpectedDigest,validArtifactDigestCommand} from '../src/web/artifact-digest-model.js';
import {materialRequest} from '../src/material-route-policy.js';

const ref={kind:'artifact',id:randomUUID(),revision:'a'.repeat(64)};
async function retained(t,bytes,{recorded=digest(bytes),size=bytes.length}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-artifact-digest-')),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),file=path.join(root,'original');
 t.after(async()=>{workspace.vault.key.fill(0);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await writeContent(workspace,file,[bytes]);
 const doc={kind:'artifact',content:{name:'release.img',size,sha256:recorded}},content=new FileContent(workspace,file,size,recorded),requests=[];
 return {requests,materials:{artifact:async(reference,options)=>{requests.push({reference,options});return {doc,content};}}};
}

test('the command contract names known algorithms and checks the published value length',()=>{
 for(const [name,{hash,hex}] of Object.entries(ARTIFACT_DIGESTS))assert.equal(createHash(hash).update('').digest('hex').length,hex,name);
 assert.equal(normalizedDigest('  ABCDEF01  release.img\n'),'abcdef01');
 assert.equal(normalizedDigest('*not hex*'),null);
 assert.ok(validExpectedDigest('sha256','A'.repeat(64)));
 assert.ok(validExpectedDigest('sha256','a'.repeat(64)+' *release.img'));
 assert.equal(validExpectedDigest('sha256','a'.repeat(63)),false);
 assert.equal(validExpectedDigest('sha512','a'.repeat(64)),false);
 assert.ok(validArtifactDigestCommand({ref,algorithm:'sha512'}));
 for(const bad of [null,[],{ref},{ref,algorithm:'crc32'},{ref,algorithm:'sha256',expected:'xyz'},{ref,algorithm:'sha256',extra:1},{ref,algorithm:'__proto__'}])assert.equal(validArtifactDigestCommand(bad),false,JSON.stringify(bad));
});

test('a retained original is checksummed exactly and compared with a published value',async t=>{
 const bytes=randomBytes(3*1024*1024+17),{materials,requests}=await retained(t,bytes);
 for(const algorithm of Object.keys(ARTIFACT_DIGESTS)){
  const expected=createHash(ARTIFACT_DIGESTS[algorithm].hash).update(bytes).digest('hex');
  const computed=await artifactDigest(materials,{ref,algorithm});
  assert.equal(computed.digest,expected,algorithm);assert.equal(computed.matches,null);assert.equal(computed.size,bytes.length);assert.equal(computed.retainedSha256,digest(bytes));
  const matched=await artifactDigest(materials,{ref,algorithm,expected:expected.toUpperCase()+'  release.img'});
  assert.equal(matched.matches,true);assert.equal(matched.expected,expected);
  const other=(expected[0]==='0'?'1':'0')+expected.slice(1);
  assert.equal((await artifactDigest(materials,{ref,algorithm,expected:other})).matches,false);
 }
 assert.equal(requests[0].options.verification,'descriptor','The digest pass itself authenticates the bytes');
});

test('progress reports bytes read and an empty original has the empty checksum',async t=>{
 const bytes=randomBytes(2*1024*1024),{materials}=await retained(t,bytes),events=[];
 await withOperationProgress(event=>events.push(event),()=>artifactDigest(materials,{ref,algorithm:'sha256'}));
 const checksum=events.filter(event=>event.stage==='checksum-file');
 assert.ok(checksum.length>=2);assert.equal(checksum.at(-1).total,bytes.length);assert.equal(checksum.at(-1).completed,bytes.length);assert.equal(checksum.at(-1).unit,'bytes');
 const empty=await retained(t,Buffer.alloc(0));
 assert.equal((await artifactDigest(empty.materials,{ref,algorithm:'sha512'})).digest,createHash('sha512').digest('hex'));
});

test('a retained original that no longer matches its recorded SHA-256 is never reported as matching',async t=>{
 const bytes=randomBytes(4096),{materials}=await retained(t,bytes,{recorded:'0'.repeat(64)});
 await assert.rejects(artifactDigest(materials,{ref,algorithm:'sha512',expected:createHash('sha512').update(bytes).digest('hex')}),error=>['MATERIAL_MISSING','MEDIA_INVALID','ENCRYPTION_DAMAGED'].includes(error.code));
 await assert.rejects(artifactDigest(materials,{ref:{...ref,kind:'dataset'},algorithm:'sha256'}),{code:'MATERIAL_INVALID'});
 await assert.rejects(artifactDigest(materials,{ref,algorithm:'sha256',expected:'abc'}),{code:'MATERIAL_INVALID'});
});

test('the checksum route is a progress-reporting read of one evidence owner',()=>{
 const route=materialRequest('/api/research/materials/artifact-digest');
 assert.equal(route.material,'artifact-digest');assert.equal(route.write,false);assert.equal(route.progress,true);assert.equal(route.method,'POST');
});
