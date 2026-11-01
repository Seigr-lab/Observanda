import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,writeContent} from '../src/file-content.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {withOperationProgress,operationStage} from '../src/operation-progress.js';

test('five-row segmented dataset preview reads a bounded authenticated prefix and keeps full verification separate',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-preview-read-work-')),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),file=path.join(root,'original'),bytes=Buffer.from('x,y\n'+'1,2\n'.repeat(800000));
 t.after(async()=>{workspace.vault.key.fill(0);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-preview-read-work-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await writeContent(workspace,file,[bytes]);const content=new FileContent(workspace,file,bytes.length,digest(bytes)),doc={kind:'artifact',content:{size:bytes.length,sha256:content.sha256}},materials={validateDataset:async()=>{},read:async()=>doc,originalContent:async()=>content,artifact:ResearchMaterials.prototype.artifact};
 const raw=await readFile(file);raw[raw.length-1]^=1;await writeFile(file,raw);
 const events=[],result=await withOperationProgress(event=>events.push(event),()=>operationStage('dataset-preview',{},()=>ResearchMaterials.prototype.previewDataset.call(materials,{artifact:{kind:'artifact'},sourceMapping:{format:'delimited',delimiter:',',header:true}})));
 assert.deepEqual(result.columns,['x','y']);assert.equal(result.rows.length,5);assert.deepEqual(result.rows[0].cells,['1','2']);assert.ok(events.at(-1).activity.bytes<2*1024*1024,'A prefix preview must not scan the untouched tail');
 await assert.rejects(materials.artifact({kind:'artifact'}),{code:'ENCRYPTION_DAMAGED'});
 raw[1000]^=1;await writeFile(file,raw);await assert.rejects(ResearchMaterials.prototype.previewDataset.call(materials,{artifact:{kind:'artifact'},sourceMapping:{format:'delimited',delimiter:',',header:true}}),{code:'ENCRYPTION_DAMAGED'});
});
