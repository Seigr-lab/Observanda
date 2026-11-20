import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {MediaStore} from '../src/media.js';
import {assertPublicFiles} from '../src/privacy.js';
import {validDownloadName} from '../src/web/website-file.js';

test('download names and binary admission reject unsafe and executable paths',()=>{
 const bytes=Buffer.from([0,1,255]),id=randomUUID();
 for(const name of ['../secrets','a/b','a\\b','bad\u0000name','..','.',' '])assert.equal(validDownloadName(name),false);
 assert.ok(validDownloadName('résultats α.img'));
 for(const name of ['downloads/'+id+'.html','downloads/'+id+'.js','downloads/../index.html','downloads/other.bin'])assert.throws(()=>assertPublicFiles(new Map([[name,bytes]])),{code:'UNSAFE'});
});

test('immediate imports and empty originals remain exact downloads without conversion',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-empty-download-'));t.after(()=>rm(root,{recursive:true,force:true}));const workspace=new Workspace(root);await workspace.create(sampleNotebook());
 const store=new MediaStore(root),asset=await store.import(Buffer.alloc(0),'file',{name:'empty.txt'});assert.equal(asset.size,0);assert.deepEqual((await store.get(asset.id)).bytes,Buffer.alloc(0));
 await assert.rejects(store.import(Buffer.alloc(0),'file',{name:'../wrong'}),{code:'MEDIA_INVALID'});
});
