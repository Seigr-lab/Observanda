import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LocalExportManifest} from '../src/local-export-manifest.js';
import {verifyLiveFiles} from '../src/publication-live.js';

test('live verification reads the reviewed file inventory and detects changed, missing and still-present files',async()=>{
 const metadata=new Map(),files=new Map(),sha=body=>createHash('sha256').update(body).digest('hex');
 const store={readMetadata:async name=>metadata.get(name)??null,writeMetadata:async(name,data)=>metadata.set(name,data),catalogue:()=>assert.fail('Opened research storage')};
 const index=new LocalExportManifest(store,{write:work=>work()}),builder=index.builder('files');
 const add=async(name,value)=>{const descriptor={path:name,bytes:Buffer.byteLength(value),sha256:sha(value)};files.set(name,value);await builder.append(descriptor);return descriptor;};
 const members=[];for(let i=0;i<70;i++)members.push(await add('notes/'+i+'.html','Result '+i));
 const releaseId=sha('reviewed release'),manifest=await add('publication.json',JSON.stringify({releaseId,files:members}));
 const receipt={releaseId,manifestHash:manifest.sha256,manifestBytes:manifest.bytes,manifestFiles:members.length,fileInventory:await builder.finish()};
 const request=async url=>{const name=url.pathname.slice(1);return files.has(name)?new Response(files.get(name)):new Response(null,{status:404});};
 const check=(r=receipt)=>verifyLiveFiles(request,'https://publication.test/',r,{fileManifest:index,removed:['retired.html'],removedCount:1});
 const result=await check();assert.equal(result.files,71);assert.equal(result.removed,1);
 files.set('retired.html','stale');await assert.rejects(check(),e=>e.issue?.reason==='removed');files.delete('retired.html');
 files.set('notes/6.html','Result X');await assert.rejects(check(),e=>e.issue?.reason==='hash');files.delete('notes/6.html');await assert.rejects(check(),e=>e.issue?.reason==='missing');
 for(const r of [{...receipt,fileInventory:null},{...receipt,manifestFiles:69},{...receipt,manifestHash:sha('unrelated manifest')}])await assert.rejects(check(r),e=>e.issue?.reason==='metadata');
});
