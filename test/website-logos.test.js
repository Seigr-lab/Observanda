import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {contentBuffer} from '../src/file-content.js';
import {applyPageLogos,homeLogos,LOGOS_STYLESHEET,PAGE_LOGOS_ATTRIBUTE} from '../src/website-logos.js';

const text=async content=>(await contentBuffer(content)).toString('utf8');
const own=images=>'<template '+PAGE_LOGOS_ATTRIBUTE+'="">'+images+'</template>';

test('a page shows its own logos, or the website\'s, at the top or in its Logos blocks, keeping every authored byte',()=>{
 const home=homeLogos('<html><head>'+own('<img src="pictures/w.png" alt="Website &quot;mark&quot;">')+'</head><body></body></html>');
 assert.deepEqual(home,[{name:'pictures/w.png',alt:'Website "mark"'}]);
 const plain='<!doctype html><html><head><title>A</title></head><body><a href="#main">Skip</a><main id="main"><p>Text</p></main></body></html>';
 assert.equal(applyPageLogos(plain,'guide/a.html',{home}).html,'<!doctype html><html><head><title>A</title><link rel="stylesheet" href="../website-logos.css"></head><body><a href="#main">Skip</a><div class="site-logos" data-observanda-logos="auto"><img src="../pictures/w.png" alt="Website &quot;mark&quot;"></div><main id="main"><p>Text</p></main></body></html>');
 // A page's own logos come first and their template is never published.
 const mine='<html><head><title>A</title>'+own('<img src="../pictures/a.png" alt="Station"><img src="../pictures/b.png">')+'</head><body><main><p>Text</p></main></body></html>';
 assert.equal(applyPageLogos(mine,'guide/a.html',{home}).html,'<html><head><title>A</title><link rel="stylesheet" href="../website-logos.css"></head><body><div class="site-logos" data-observanda-logos="auto"><img src="../pictures/a.png" alt="Station"><img src="../pictures/b.png" alt=""></div><main><p>Text</p></main></body></html>');
 // Blocks take the automatic place: one for this page, one for the website.
 const blocks='<html><head>'+own('<img src="../pictures/a.png" alt="Station">')+'</head><body><main><div class="site-logos" data-observanda-logos="auto" data-section-id="s"></div><div class="site-logos" data-observanda-logos="home"></div></main></body></html>';
 const filled=applyPageLogos(blocks,'guide/a.html',{home}).html;
 assert.ok(filled.includes('data-observanda-logos="auto" data-section-id="s"><img src="../pictures/a.png" alt="Station"></div><div class="site-logos" data-observanda-logos="home"><img src="../pictures/w.png" alt="Website &quot;mark&quot;"></div>')&&!filled.includes('<template'));
 // Nothing to show adds nothing; an empty template is still removed.
 assert.equal(applyPageLogos(plain,'a.html',{home:[]}).html,plain);
 assert.equal(applyPageLogos('<html><head>'+own('')+'</head><body></body></html>','a.html',{home:[]}).html,'<html><head></head><body></body></html>');
});

test('page and website logos publish and preview from the website\'s own files, never from research storage',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-page-logos-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{key:randomBytes(32),id:randomUUID()});
 workspace.catalogue=()=>assert.fail('Logos attempted to open a research database');
 const store=new WebsiteFileStore(workspace),id=randomUUID(),created=await store.create({id,name:'Field station'});
 const png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url)),mark='pictures/'+randomUUID()+'.png',station='pictures/'+randomUUID()+'.png';
 const page=(title,head='')=>'<!doctype html><html><head><title>'+title+'</title>'+head+'</head><body><main><h1>'+title+'</h1></main></body></html>';
 const home=page('Home',own('<img src="'+mark+'" alt="Station mark">'));
 let site=await store.save(id,{expectedRevision:created.site.revision,path:'index.html',html:home,css:'',receivePictures:async function*(){yield {name:mark,bytes:png};}});
 const add=async(path,title)=>{site=await store.createPage(id,{expectedRevision:site.site.revision,path,title,inclusion:'included'});};
 await add('about.html','About');site=await store.save(id,{expectedRevision:site.site.revision,path:'about.html',html:page('About'),css:''});
 await add('guide/station.html','Station');
 site=await store.save(id,{expectedRevision:site.site.revision,path:'guide/station.html',html:page('Station',own('<img src="../'+station+'" alt="Field station">')),css:'',receivePictures:async function*(){yield {name:station,bytes:png};}});
 const revision=site.site.revision,exported=await store.export(id,{expectedRevision:revision}),files=exported.files;
 const logos=images=>'<body><div class="site-logos" data-observanda-logos="auto">'+images+'</div><main>';
 assert.ok((await text(files.get('index.html'))).includes(logos('<img src="'+mark+'" alt="Station mark">')));
 assert.ok((await text(files.get('about.html'))).includes(logos('<img src="'+mark+'" alt="Station mark">')),'A page without its own logos shows the website\'s');
 const guide=await text(files.get('guide/station.html'));
 assert.ok(guide.includes(logos('<img src="../'+station+'" alt="Field station">'))&&!guide.includes(mark)&&!guide.includes('<template'));
 assert.ok(files.has(mark)&&files.has(station)&&files.has(LOGOS_STYLESHEET));
 assert.ok((await store.publicationInventory(id)).files.includes(LOGOS_STYLESHEET));
 // Previewing serves the same pages; the editor keeps the authored page.
 for(const name of ['about.html','guide/station.html'])assert.equal((await store.file(id,name,{revision})).content.toString('utf8'),await text(files.get(name)));
 assert.equal((await store.file(id,LOGOS_STYLESHEET,{revision})).contentType,'text/css; charset=utf-8');
 assert.ok((await text((await store.file(id,'index.html',{revision,editor:true})).content)).includes('<template '+PAGE_LOGOS_ATTRIBUTE));
 // Removing the website's logos retires their picture and the stylesheet when nothing shows logos.
 site=await store.save(id,{expectedRevision:revision,path:'index.html',html:page('Home'),css:''});
 site=await store.save(id,{expectedRevision:site.site.revision,path:'guide/station.html',html:page('Station'),css:''});
 const after=(await store.export(id,{expectedRevision:site.site.revision})).files;
 assert.ok(!after.has(mark)&&!after.has(station)&&!after.has(LOGOS_STYLESHEET));
});
