import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
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
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-empty-download-')),{workspace,vault}=await encryptedFixture(directory,sampleNotebook());t.after(async()=>{await clearVault(vault);await rm(directory,{recursive:true,force:true});});
 const store=new MediaStore(workspace),asset=await store.import(Buffer.alloc(0),'file',{name:'empty.txt'});assert.equal(asset.size,0);assert.deepEqual((await store.get(asset.id)).bytes,Buffer.alloc(0));
 await assert.rejects(store.import(Buffer.alloc(0),'file',{name:'../wrong'}),{code:'MEDIA_INVALID'});
});
