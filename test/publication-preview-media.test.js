import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationPreviewMedia} from '../src/publication-preview-media.js';
import {FileContent,contentBuffer} from '../src/file-content.js';
import {MediaStore} from '../src/media.js';

test('preview media reauthorizes the exact owner after the page read closes, without copying bytes',async t=>{
 const publicId=randomUUID(),origin={workspaceId:randomUUID(),snapshotId:'a'.repeat(64),attachmentId:randomUUID()},storage=new Workspace(os.tmpdir()),origins=new Map([[publicId,origin]]);let active=0,closed=0,denied=false,hash='b'.repeat(64);
 class Source extends FileContent{async *read(){assert.equal(active,1);yield Buffer.from('image');}async verify(){assert.equal(active,1);}}
 t.mock.method(MediaStore.prototype,'get',async function(id){assert.equal(this.workspace,storage);assert.equal(id,origin.attachmentId);assert.equal(active,1);return {id,kind:'image',extension:'png',mime:'image/png',bytes:new Source(storage,'synthetic',5,hash,Buffer.from('header'))};});
 const reader=async()=>({use:async(namespace,snapshot,consume)=>{assert.equal(namespace,origin.workspaceId);assert.equal(snapshot,origin.snapshotId);if(denied)throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});active++;return {value:await consume(null,null,{storage})};},verify:async()=>{},close:async()=>{active=0;closed++;}});
 const media=publicationPreviewMedia(new Workspace(os.tmpdir()),origins,reader),file=await media.get(publicId,{streamed:true});assert.equal(active,0);assert.equal(closed,1);assert.equal(file.id,publicId);assert.equal(file.bytes.header.toString(),'header');
 assert.equal((await contentBuffer(file.bytes)).toString(),'image');assert.equal(active,0);assert.equal(closed,2);
 hash='c'.repeat(64);await assert.rejects(contentBuffer(file.bytes),{code:'MEDIA_INVALID'});assert.equal(active,0);
 denied=true;await assert.rejects(contentBuffer(file.bytes),{code:'ACCESS_LOCKED'});assert.equal(active,0);assert.equal(closed,4);
});

test('cancelling a deferred preview cancels pending owner acquisition and closes its lease',async t=>{
 const publicId=randomUUID(),origin={workspaceId:randomUUID(),snapshotId:'a'.repeat(64),attachmentId:randomUUID()},storage=new Workspace(os.tmpdir());let delay=false,entered,closed=0;
 class Source extends FileContent{async *read(){yield Buffer.from('image');}async verify(){}}
 t.mock.method(MediaStore.prototype,'get',async()=>({id:origin.attachmentId,kind:'image',extension:'png',mime:'image/png',bytes:new Source(storage,'synthetic',5,'b'.repeat(64))}));
 const reader=async({signal}={})=>({use:async(_id,_snapshot,consume)=>{
  if(delay){entered();await new Promise((resolve,reject)=>{if(signal?.aborted)reject(signal.reason);else signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});}
  return {value:await consume(null,null,{storage})};
 },verify:async()=>{},close:async()=>{closed++;}});
 const file=await publicationPreviewMedia(new Workspace(os.tmpdir()),new Map([[publicId,origin]]),reader).get(publicId),controller=new AbortController();delay=true;
 const waiting=new Promise(resolve=>entered=resolve),reading=file.bytes.read(0,4,{signal:controller.signal}),rejection=assert.rejects(reading.next(),{name:'AbortError'});await waiting;controller.abort();await rejection;await reading.return();assert.equal(closed,2);
});
