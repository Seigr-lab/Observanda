import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {websitePictureUpload} from '../src/website-picture-upload.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

test('a saved gallery commits its pictures together, rejects truncated uploads, and retires removed pictures',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-website-picture-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{key:randomBytes(32),id:randomUUID()});
 workspace.catalogue=()=>assert.fail('Gallery attempted to open a research database');
 const store=new WebsiteFileStore(workspace),id=randomUUID(),created=await store.create({id,name:'Field photographs'});
 const png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
 const names=[randomUUID(),randomUUID()].map(id=>'pictures/'+id+'.png');
 const html='<html><head><script defer src="public-gallery.js"></script><link rel="stylesheet" href="public-gallery.css"></head><body><main>'+names.map(src=>'<img alt="Field sample" src="'+src+'">').join('')+'</main></body></html>';
 const header=Buffer.from(JSON.stringify({siteId:id,expectedRevision:created.site.revision,path:'index.html',html,css:'',pictures:names.map(name=>({name,size:png.length}))}));
 const prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 async function submit(parts){
  const {data,pictures}=await websitePictureUpload(Readable.from([prefix.subarray(0,1),prefix.subarray(1),header,...parts]));
  return store.save(id,{...data,receivePictures:pictures});
 }
 await assert.rejects(submit([png,png.subarray(0,-1)]),{code:'INVALID'});
 assert.equal((await store.open(id)).site.revision,created.site.revision);
 const saved=await submit([png,png]),output=await store.export(id,{expectedRevision:saved.site.revision});
 for(const name of [...names,'public-gallery.js','public-gallery.css'])assert.ok(output.files.has(name));
 const removed=await store.save(id,{expectedRevision:saved.site.revision,path:'index.html',html:created.html,css:''});
 const files=(await store.export(id,{expectedRevision:removed.site.revision})).files;
 for(const name of names)assert.ok(!files.has(name));
});
