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
import {retainEditHistory} from '../src/website-edit-history.js';
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

test('only the editing page can restore its retired image and published files exclude retired bytes',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-history-gallery-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{key:randomBytes(32),id:randomUUID()}),store=new WebsiteFileStore(workspace);
 const id=randomUUID(),historyKey=randomUUID(),name='pictures/'+randomUUID()+'.png';
 const png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url)),created=await store.create({id,name:'Image history'});
 const html=created.html.replace('</main>','<img src="'+name+'" alt="Specimen"></main>');
 const saved=await store.save(id,{expectedRevision:created.site.revision,historyKey,html,css:'',receivePictures:async function*(){yield {name,bytes:png};}});
 const removed=await store.save(id,{expectedRevision:saved.site.revision,historyKey,html:created.html,css:''}),revision=removed.site.revision;
 assert.ok(removed.historyAssetStamp);assert.ok(!(await store.export(id,{expectedRevision:revision})).files.has(name));
 assert.ok(!(await store.publicationInventory(id,{expectedRevision:revision})).files.includes(name));
 await assert.rejects(store.file(id,name,{revision,editor:true}),{code:'NOT_FOUND'});
 await assert.rejects(store.file(id,name,{revision:removed.historyAssetStamp}),{code:'CONFLICT'});
 const held=(await store.file(id,name,{revision:removed.historyAssetStamp,editor:true})).content;
 assert.deepEqual(Buffer.concat(await Array.fromAsync(held.read())),png);
 const status=(key,path)=>store.versionStatus(id,{path,expectedRevision:revision,historyKey:key,media:[name]});
 assert.equal((await status(historyKey,'index.html')).mediaAvailable,true);
 assert.equal((await status(randomUUID(),'index.html')).mediaAvailable,false);
 assert.equal((await status(historyKey,'other.html')).mediaAvailable,false);
 for(const [key,path] of [[randomUUID(),'index.html'],[historyKey,'other.html']]){
  // A foreign history key cannot claim the image; a page that does not exist
  // cannot be saved at all. Neither attempt changes the saved revision.
  await assert.rejects(store.save(id,{path,historyKey:key,expectedRevision:revision,html,css:''}),{code:path==='index.html'?'INVALID':'NOT_FOUND'});
  assert.equal((await store.open(id)).site.revision,revision);
 }
 const restored=await store.save(id,{expectedRevision:revision,historyKey,html,css:''});
 assert.ok((await store.export(id,{expectedRevision:restored.site.revision})).files.has(name));assert.equal(restored.historyAssetStamp,undefined);
});

test('session media retention admits only bounded website-owned files',()=>{
 const key=randomUUID(),page='index.html';
 const picture=(overrides={})=>({name:'pictures/'+randomUUID()+'.png',contentType:'image/png',picture:true,size:1024,...overrides});
 const large=picture({size:129*1024*1024}),privateSource=picture({sourceId:'f'.repeat(64)}),fromFeed=picture({feedAsset:true});
 const owned=Array.from({length:258},()=>picture());
 const files=[large,privateSource,fromFeed,...owned];
 const manifest={files,pages:[{path:page,pictures:files.map(f=>f.name)}]};
 assert.deepEqual(retainEditHistory(manifest,[],key,page).history.files,owned.slice(0,256));
});
