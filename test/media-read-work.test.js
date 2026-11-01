import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {MediaStore} from '../src/media.js';
import {writeContent} from '../src/file-content.js';
import {withOperationProgress,operationStage} from '../src/operation-progress.js';

test('buffered prepared media verifies its content once and reuses those bytes for its header',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-media-read-work-')),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),bytes=randomBytes(3*1024*1024+19),id=randomUUID();
 t.after(async()=>{workspace.vault.key.fill(0);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-media-read-work-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await writeContent(workspace,path.join(root,'public.png'),[bytes]);workspace.storageKind=async()=> 'document';
 const store=new MediaStore(workspace);store.metadata=async()=>({directory:root,metadata:{id,kind:'image',bytes:bytes.length,sha256:digest(bytes),extension:'png',mime:'image/png'}});
 const events=[];const result=await withOperationProgress(event=>events.push(event),()=>operationStage('buffered-media',{},()=>store.get(id)));
 assert.deepEqual(result.bytes,bytes);assert.equal(events.at(-1).activity.bytes,bytes.length);
});
