import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {MediaStore} from '../src/media.js';
import {Workspace,digest} from '../src/storage.js';
import {MediaPolicy,defaultMediaPolicy} from '../src/media-policy.js';
import {createNotebook} from '../src/model.js';
import {buildPublication} from '../src/publication.js';
const svg=body=>Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">${body}</svg>`);
async function fixture(vault=null){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-svg-'));return {root,store:new MediaStore(root,vault)};}

test('SVG originals remain exact and encrypted; only a static prepared image reaches publication',async()=>{
 const vault={id:randomUUID(),key:randomBytes(32)}, {root,store}=await fixture(vault);
 const original=svg('<metadata>PRIVATE /home/private/source.svg</metadata><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><style>.mark{fill:url(#g)}</style><path class="mark" d="M5 5H115V75H5Z"/>');
 const asset=await store.import(original,'image'),dir=path.join(root,'.observanda/media',asset.id);
 const ws=new Workspace(root,vault);
 assert.deepEqual(await ws.readFile(path.join(dir,'original')),original);
 assert.ok(!(await readFile(path.join(dir,'original'))).includes(Buffer.from('PRIVATE')));
 const metadata=JSON.parse(await ws.readFile(path.join(dir,'asset.json'),'utf8'));
 assert.equal(metadata.originalSha256,digest(original));assert.equal(metadata.originalBytes,original.length);
 const prepared=await store.get(asset.id);assert.equal(prepared.mime,'image/png');
 assert.equal(prepared.bytes.readUInt32BE(16),120);assert.equal(prepared.bytes.readUInt32BE(20),80);
 const book=createNotebook('Studio');book.website.home.enabled=true;book.branding=[{target:'home',logos:[{id:asset.id,alt:'Studio mark'}]}];
 const candidate=buildPublication(book,{mediaFiles:await store.publicFiles(book)});
 assert.ok([...candidate.files.keys()].some(name=>name.endsWith(asset.id+'.png')));
 for(const content of candidate.files.values())assert.ok(!Buffer.from(content).includes(Buffer.from('PRIVATE')));
 assert.ok(!prepared.bytes.includes(Buffer.from('<svg')));
});

test('SVG imports reject external resources and active content without fetching or leaving partial assets',async t=>{
 const {root,store}=await fixture();let requests=0;
 const server=http.createServer((req,res)=>{requests++;res.end('not an image');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const local=path.join(root,'private.png');await writeFile(local,'PRIVATE');
 for(const body of [`<image href="http://127.0.0.1:${server.address().port}/x"/>`,`<image href="${local}"/>`,'<use href="file:///private.svg#mark"/>','<style>@import "https://invalid.test/style.css";</style>']){
  await assert.rejects(store.import(svg(body),'image'),{code:'SVG_EXTERNAL'});
 }
 for(const body of ['<script>alert(1)</script>','<rect onload="alert(1)"/>','<foreignObject><div>HTML</div></foreignObject>','<animate attributeName="x"/>'])await assert.rejects(store.import(svg(body),'image'),{code:'SVG_STATIC'});
 await assert.rejects(store.import(Buffer.from('<!DOCTYPE svg [<!ENTITY secret SYSTEM "file:///secret">]><svg xmlns="http://www.w3.org/2000/svg">&secret;</svg>'),'image'),{code:'SVG_EXTERNAL'});
 assert.equal(requests,0);assert.deepEqual(await readdir(path.join(root,'.observanda/media')),[]);
});

test('SVG import rejects malformed files and oversized canvases, respects output limits and cancellation',async()=>{
 const {root,store}=await fixture();
 await assert.rejects(store.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><broken></svg>'),'image'),{code:'MEDIA_INVALID'});
 await assert.rejects(store.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="999999" height="999999"/>'),'image'),{code:'SVG_LIMIT'});
 const policy=new MediaPolicy(root);await policy.save({...defaultMediaPolicy(),maxPreparedBytes:10},'new');
 await assert.rejects(store.import(svg('<circle r="20"/>'),'image'),{code:'MEDIA_LIMIT'});
 const controller=new AbortController();controller.abort();
 await assert.rejects(store.import(svg('<circle r="20"/>'),'image',{signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual(await readdir(path.join(root,'.observanda/media')),[]);
});
