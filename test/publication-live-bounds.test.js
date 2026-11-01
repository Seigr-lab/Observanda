import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spoolLiveManifest,liveManifestFrameBytes} from '../src/publication-live-spool.js';
import {retainLiveManifest} from '../src/publication-live-manifest.js';
import {liveManifestReceipt,reviewedManifest} from '../src/publication-live-budget.js';
import {ENCRYPTION_OVERHEAD} from '../src/encryption.js';

const fail=reason=>Object.assign(new Error(reason),{reason}),hash=value=>createHash('sha256').update(value).digest('hex');
function scratch(){
 const values=new Map(),batches=[];let payloadBytes=0;
 return {values,batches,get payloadBytes(){return payloadBytes;},async putMany(entries){batches.push(entries.length);for(const [key,value] of entries){assert.ok(!values.has(key));values.set(key,value);payloadBytes+=Buffer.byteLength(JSON.stringify(value))+ENCRYPTION_OVERHEAD;}},async get(key){return values.get(key);},async getMany(keys){return new Map(keys.filter(key=>values.has(key)).map(key=>[key,values.get(key)]));},async remove(key){values.delete(key);}};
}
async function* split(bytes,size){for(let offset=0;offset<bytes.length;offset+=size)yield bytes.subarray(offset,offset+size);}

test('single-byte network chunks cannot increase encrypted manifest spool row count',async()=>{
 const bytes=Buffer.alloc(liveManifestFrameBytes*3+23,123),work=scratch(),controller=new AbortController();
 const stored=await spoolLiveManifest(split(bytes,1),work,bytes.length,{signal:controller.signal,fail});
 assert.equal(stored.rows,4);assert.deepEqual(work.batches,[4]);assert.equal(stored.payloadBytes,work.payloadBytes);
 assert.ok(stored.payloadBytes<=4*Math.ceil(bytes.length/3)+4*(6+ENCRYPTION_OVERHEAD));
 // The completed request's cancellation must not revoke the retained proof.
 controller.abort();const result=Buffer.concat(await Array.fromAsync(stored.chunks()));assert.deepEqual(result,bytes);assert.equal(work.values.size,0);
});

test('manifest frames have bounded batches and reject excess bytes before retention',async()=>{
 const bytes=Buffer.alloc(liveManifestFrameBytes*33+7,7),work=scratch(),stored=await spoolLiveManifest(split(bytes,32768),work,bytes.length,{fail});
 assert.equal(stored.rows,34);assert.deepEqual(work.batches,[32,2]);assert.deepEqual(Buffer.concat(await Array.fromAsync(stored.chunks())),bytes);
 for(const declared of [2,4]){const rejected=scratch();await assert.rejects(spoolLiveManifest([Buffer.from('abc')],rejected,declared,{fail}),{reason:'size'});assert.equal(rejected.values.size,0);}
 await assert.rejects(spoolLiveManifest([],scratch(),Number.MAX_SAFE_INTEGER,{fail}),{reason:'size'});
});

test('authenticated descriptors cannot exceed their reviewed count or retained payload budget',async()=>{
 const row=index=>({path:index+'.html',bytes:0,sha256:hash('')}),rows=Array.from({length:65},(_,index)=>row(index)),body=Buffer.from(JSON.stringify({releaseId:'edition',files:rows}));
 const work=scratch();await assert.rejects(retainLiveManifest([body],work,'edition',{expectedFiles:32,maxBytes:body.length,fail}),{reason:'manifest'});
 assert.equal(work.values.size,32);assert.deepEqual(work.batches,[32]);
 const small=scratch();await assert.rejects(retainLiveManifest([body],small,'edition',{expectedFiles:65,maxBytes:1,fail}),{reason:'manifest'});assert.equal(small.values.size,0);
 const valid=scratch();assert.equal(await retainLiveManifest(split(body,17),valid,'edition',{expectedFiles:65,maxBytes:body.length,fail}),65);assert.equal(valid.values.size,65);
 await assert.rejects(retainLiveManifest([body],scratch(),'edition',{expectedFiles:66,maxBytes:body.length,fail}),{reason:'manifest'});
});

test('reviewed manifest receipts record UTF-8 bytes and never infer bounds from remote metadata',async()=>{
 const body=JSON.stringify({releaseId:'edition',title:'Ångström',files:[]}),candidate={files:new Map([['publication.json',body]])};
 const proof=await reviewedManifest(candidate);assert.deepEqual(proof,{manifestHash:hash(body),manifestBytes:Buffer.byteLength(body),manifestFiles:0});assert.ok(proof.manifestBytes>body.length);
 const workspace={async readMetadata(){throw Error('unexpected storage read');}};
 assert.equal(await liveManifestReceipt(workspace,'key',proof),proof);
 assert.equal(await liveManifestReceipt(workspace,'key',{releaseId:'edition',manifestHash:hash(body)}),null);
 assert.equal(await liveManifestReceipt(workspace,'key',{...proof,manifestBytes:undefined}),null);
});

test('legacy receipt bounds require matching local deployment and retained manifest evidence',async()=>{
 const id=hash('edition'),reviewId=hash('review'),deploymentId=randomUUID(),body='retained manifest',receipt={releaseId:id,deploymentId,commit:hash('commit'),manifestHash:hash(body)};
 const deployment={version:1,id:deploymentId,intent:{key:'destination',releaseId:id,reviewId},journal:{receipt:{...receipt}}};
 const candidate={version:1,id,reviewId,jobId:randomUUID(),attempt:randomUUID(),files:[{name:'index.html',size:1,sha256:hash('a')},{name:'publication.json',size:Buffer.byteLength(body),sha256:hash(body)}]};
 const metadata=new Map([['.observanda/deployments/'+deploymentId+'.json',deployment],['.observanda/release-candidates/'+reviewId+'.json',candidate]]);
 const workspace={websiteContext:true,websiteId:null,metadataPath:name=>name,async readMetadata(name){assert.ok(metadata.has(name),'only matched local metadata can supply the bounds');const value=metadata.get(name);return value===null?null:JSON.stringify(value);}};
 assert.deepEqual(await liveManifestReceipt(workspace,'destination',receipt),{...receipt,manifestBytes:body.length,manifestFiles:1});
 candidate.version=2;candidate.websiteId=null;candidate.etag=hash('research');candidate.websitePin={researchSnapshotId:candidate.etag,websiteId:null,websiteRevision:null};
 assert.equal((await liveManifestReceipt(workspace,'destination',receipt)).manifestFiles,1);
 await assert.rejects(liveManifestReceipt(workspace,'other-destination',receipt),{code:'JOB_DAMAGED'});
 candidate.files[1].sha256=hash('changed');await assert.rejects(liveManifestReceipt(workspace,'destination',receipt),{code:'JOB_DAMAGED'});
 metadata.set('.observanda/release-candidates/'+reviewId+'.json',null);assert.equal(await liveManifestReceipt(workspace,'destination',receipt),null);
});
