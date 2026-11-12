import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {deflateRawSync,crc32} from 'node:zlib';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {zipStream} from '../src/zip-stream.js';
import {importStaticWebsite,readWebsiteFolder,readWebsiteZip,reviewWebsiteImport,websiteImportLimits} from '../src/website-import.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'website-import-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Importing a website opened research storage');
 return {root,store:new WebsiteFileStore(workspace)};
}
// A minimal ZIP writer for archives other tools produce: deflated entries, a
// wrapping folder, the encryption flag or a damaged checksum.
function zip(entries,{encrypted=false,damaged=false}={}){
 const locals=[],central=[];let offset=0;
 for(const [name,value] of entries){
  const bytes=Buffer.from(value),packed=deflateRawSync(bytes),file=Buffer.from(name),crc=(crc32(bytes)^(damaged?1:0))>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800|(encrypted?1:0),6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(file.length,26);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800|(encrypted?1:0),8);record.writeUInt16LE(8,10);record.writeUInt32LE(crc,16);record.writeUInt32LE(packed.length,20);record.writeUInt32LE(bytes.length,24);record.writeUInt16LE(file.length,28);record.writeUInt32LE(offset,42);
  locals.push(local,file,packed);central.push(record,file);offset+=local.length+file.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
const page=(title,body='')=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';

test('a website ZIP exported by Observanda imports back as a new website with its pages and styles',async t=>{
 const {store}=await fixture(t),id=randomUUID();
 const created=await store.create({id,name:'Field notes',html:page('Field notes','<p><a href="methods.html">Methods</a></p>'),css:'main{color:rgb(20,40,60)}'});
 const methods=await store.createPage(id,{expectedRevision:created.site.revision,path:'methods.html',title:'Methods',inclusion:'included'});
 const exported=await store.export(id,{expectedRevision:methods.site.revision});
 const chunks=[];for await(const chunk of zipStream(exported.files))chunks.push(chunk);
 const entries=readWebsiteZip(Buffer.concat(chunks));
 assert.deepEqual(entries.map(entry=>entry.name).sort(),[...exported.files.keys()].sort());
 const imported=await importStaticWebsite(store,{name:'Field notes copy',source:'zip',read:async()=>entries});
 assert.equal(imported.issues,undefined);assert.notEqual(imported.site.id,id);
 assert.deepEqual(imported.site.pages.map(p=>p.path).sort(),['index.html','methods.html']);
 assert.equal((await store.open(imported.site.id,{path:'index.html'})).css,'main{color:rgb(20,40,60)}');
});

test('a ZIP wrapped in its folder imports from that folder and skips hidden and system files',async t=>{
 const {store}=await fixture(t);
 const archive=zip([['site/index.html',page('Weather station','<img src="images/mast.png" alt="Mast">')],['site/style.css','body{margin:0}'],['site/images/mast.png',Buffer.from([137,80,78,71])],['site/.DS_Store','x'],['__MACOSX/site/._index.html','x'],['site/Thumbs.db','x']]);
 const result=await importStaticWebsite(store,{name:'Weather station',source:'zip',read:async()=>readWebsiteZip(archive)});
 assert.equal(result.issues,undefined);assert.equal(result.skipped,3);
 const opened=await store.open(result.site.id);assert.match(opened.html,/Weather station/);
 assert.ok(result.site.pages.some(p=>p.path==='index.html'));
});

test('every unsupported file is listed and nothing is imported, including research placed by Observanda',async t=>{
 const {store}=await fixture(t);
 const placed='<section data-observanda-source="'+'a'.repeat(64)+'" data-observanda-source-revision="'+'b'.repeat(64)+'"><p>Withheld assay</p></section>';
 const entries=[
  {name:'index.html',bytes:Buffer.from(page('Home','<p>Intro</p>\n<script>alert(1)</script>'))},
  {name:'results.html',bytes:Buffer.from(page('Results',placed))},
  {name:'notes/CON.html',bytes:Buffer.from(page('Reserved'))},
  {name:'style.css',bytes:Buffer.from([0xff,0xfe,0x00])},
  {name:'Style.CSS',bytes:Buffer.from('p{}')}
 ];
 const review=reviewWebsiteImport(entries),reasons=new Map(review.issues.map(item=>[item.file,item]));
 assert.equal(reasons.get('index.html').reason,'sourceReason_script');assert.equal(reasons.get('index.html').line,2);
 assert.equal(reasons.get('results.html').reason,'importLabBook');
 assert.equal(reasons.get('notes/CON.html').reason,'importName');
 assert.equal(reasons.get('style.css').reason,'importEncoding');
 assert.equal(reasons.get('Style.CSS').reason,'importDuplicate');
 const result=await importStaticWebsite(store,{name:'Rejected',source:'zip',read:async()=>entries});
 assert.equal(result.issueCount,5);assert.equal(result.site,undefined);
 assert.deepEqual((await store.list({limit:10})).items,[]);
 assert.deepEqual(reviewWebsiteImport([{name:'about.html',bytes:Buffer.from(page('About'))}]).issues,[{file:'index.html',reason:'importIndex'}]);
});

test('encrypted, damaged and oversized archives are refused before any file is used',async t=>{
 const {store}=await fixture(t),home=[['index.html',page('Home')]];
 assert.throws(()=>readWebsiteZip(zip(home,{encrypted:true})),{code:'INVALID'});
 assert.throws(()=>readWebsiteZip(zip(home,{damaged:true})),{code:'INVALID'});
 assert.throws(()=>readWebsiteZip(Buffer.from('not an archive at all, just text')),{code:'INVALID'});
 assert.throws(()=>readWebsiteZip(zip([['index.html','x'.repeat(2048)]]),{...websiteImportLimits,file:1024}),{code:'LIMIT'});
 assert.throws(()=>readWebsiteZip(zip(home.concat([['a.css','a'],['b.css','b']])),{...websiteImportLimits,files:2}),{code:'LIMIT'});
 const damaged=await importStaticWebsite(store,{name:'Damaged',source:'zip',read:async()=>readWebsiteZip(zip(home,{damaged:true}))});
 assert.deepEqual(damaged.issues,[{file:'',reason:'importZipDamaged'}]);
 const large=await importStaticWebsite(store,{name:'Large',source:'zip',read:async()=>readWebsiteZip(zip([['index.html','x'.repeat(2048)]]),{...websiteImportLimits,file:1024})});
 assert.deepEqual(large.issues,[{file:'',reason:'importLimit'}]);
 assert.deepEqual((await store.list({limit:10})).items,[]);
});

test('a website folder is read through the native file service with nested assets and without hidden files',async t=>{
 const {store}=await fixture(t),folder=await mkdtemp(path.join(os.tmpdir(),'website-import-folder-'));
 t.after(()=>rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 await mkdir(path.join(folder,'guides','images'),{recursive:true});await mkdir(path.join(folder,'.git'));
 await writeFile(path.join(folder,'index.html'),page('Field guide','<p><a href="guides/birds.html">Birds</a></p>'));
 await writeFile(path.join(folder,'style.css'),'body{font-family:serif}');
 await writeFile(path.join(folder,'guides','birds.html'),page('Birds','<img src="images/heron.png" alt="Heron">').replace('href="style.css"','href="../style.css"'));
 await writeFile(path.join(folder,'guides','images','heron.png'),Buffer.from([137,80,78,71,13,10,26,10]));
 await writeFile(path.join(folder,'.git','config'),'[core]');
 const entries=await readWebsiteFolder(folder);
 assert.deepEqual(entries.map(entry=>entry.name),['guides/birds.html','guides/images/heron.png','index.html','style.css']);
 const result=await importStaticWebsite(store,{name:'Field guide',source:'folder',read:()=>readWebsiteFolder(folder)});
 assert.equal(result.issues,undefined);
 assert.deepEqual(result.site.pages.map(p=>p.path).sort(),['guides/birds.html','index.html']);
 const many=await importStaticWebsite(store,{name:'Too many',source:'folder',read:()=>readWebsiteFolder(folder,{limits:{...websiteImportLimits,files:2}})});
 assert.deepEqual(many.issues,[{file:'',reason:'importLimit'}]);
});
