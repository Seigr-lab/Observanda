import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,realpath} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {MediaStore} from '../src/media.js';
import {contentBuffer} from '../src/file-content.js';
import {applyPageLogos,chosenLogos,LOGOS_STYLESHEET,PAGE_LOGOS_ATTRIBUTE} from '../src/website-logos.js';

const svg=fill=>Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="'+fill+'"/></svg>');
const text=async content=>(await contentBuffer(content)).toString('utf8');

test('a saved branding choice wins, even an empty one, before each default along the chain',()=>{
 const lab={id:randomUUID(),alt:'Lab'},project={id:randomUUID(),alt:'Project'},website={id:randomUUID(),alt:'Website'};
 const saved=new Map([['notebook:n',{target:'notebook:n',logos:[lab]}],['entry:hidden',{target:'entry:hidden',logos:[]}]]);
 const branding={override:target=>saved.get(target)??null,fallback:target=>target==='home'?[website]:target==='project:p'?[project]:[]};
 assert.deepEqual(chosenLogos(['entry:r','notebook:n','project:p','home'],branding),[lab]);
 assert.deepEqual(chosenLogos(['entry:r','notebook:other','project:p','home'],branding),[project]);
 assert.deepEqual(chosenLogos(['entry:hidden','home'],branding),[]);
 assert.deepEqual(chosenLogos(['entry:r','home'],branding),[website]);
});

test('Logos blocks are filled and a page without one shows its logos at the top, keeping every authored byte',()=>{
 const id=randomUUID(),names=new Map([[id,'logos/'+id+'.png']]),logos={auto:[{id,alt:'Field station'}],home:[{id,alt:'Website "mark"'}]};
 const plain='<!doctype html><html><head><title>A</title></head><body><a href="#main">Skip</a><main id="main"><p>Text</p></main></body></html>';
 assert.equal(applyPageLogos(plain,'guide/a.html',{logos,names}).html,'<!doctype html><html><head><title>A</title><link rel="stylesheet" href="../website-logos.css"></head><body><a href="#main">Skip</a><div class="site-logos" data-observanda-logos="auto"><img src="../logos/'+id+'.png" alt="Field station"></div><main id="main"><p>Text</p></main></body></html>');
 const block='<html><head></head><body><main><div class="site-logos" data-observanda-logos="home" data-section-id="s"></div><p>After</p></main></body></html>';
 const filled=applyPageLogos(block,'index.html',{logos,names});
 assert.ok(filled.html.includes('<div class="site-logos" data-observanda-logos="home" data-section-id="s"><img src="logos/'+id+'.png" alt="Website &quot;mark&quot;"></div><p>After</p>'));
 assert.ok(filled.html.includes('<link rel="stylesheet" href="website-logos.css"></head>'));assert.deepEqual([...filled.used],['logos/'+id+'.png']);
 // A block takes the automatic place; a block with no logos stays empty and adds nothing.
 const empty=applyPageLogos(block,'index.html',{logos:{auto:[{id,alt:''}],home:[]},names});
 assert.equal(empty.html,block);assert.equal(empty.shown,false);
 assert.equal(applyPageLogos(plain,'a.html',{logos:{auto:[]},names}).html,plain);
});

test('a website made in the website editor publishes and previews the logos its branding gives each page',async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-website-logos-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const sites=new WebsiteSites(f.workspace),websiteId=(await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Field journal'})).id;
 const media=new MediaStore(f.workspace),logo=async fill=>media.get((await media.import(svg(fill),'image')).id);
 const homeLogo=await logo('teal'),projectLogo=await logo('navy'),other=await logo('red');
 const projectId=(await f.workspace.outline()).metadata.projects[0].id;
 const editor=new WebsiteEditor(f.workspace),execute=(operation,data={})=>editor.execute(operation,{workspaceId:book.id,websiteId,...data});
 const opened=await execute('open');
 const changed=await execute('change',{websitePin:opened.websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[
  {type:'replace',collection:'branding',key:'home',value:{target:'home',logos:[{id:homeLogo.id,alt:'Field station'}]}},
  {type:'replace',collection:'branding',key:'project:'+projectId,value:{target:'project:'+projectId,logos:[{id:projectLogo.id,alt:'Apiary project'}]}}]});
 await execute('save',{draftId:changed.draft.id,expectedRevision:changed.draft.revision,commandId:randomUUID()});
 const store=new WebsiteFileStore(f.workspace),page=body=>'<!doctype html><html><head><meta charset="utf-8"><title>Page</title><link rel="stylesheet" href="style.css"></head><body><main>'+body+'</main></body></html>';
 await store.importFiles(websiteId,{name:'Field journal',files:new Map([['index.html',page('<h1>Home</h1>')],['about.html',page('<h1>About</h1><div class="site-logos" data-observanda-logos="project:'+projectId+'"></div>')],['style.css','body{margin:0}']])});
 const exported=await store.export(websiteId),files=exported.files,home='logos/'+homeLogo.id+'.'+homeLogo.extension,project='logos/'+projectLogo.id+'.'+projectLogo.extension;
 assert.match(await text(files.get('index.html')),new RegExp('<body><div class="site-logos" data-observanda-logos="auto"><img src="'+home+'" alt="Field station"></div><main>'));
 const about=await text(files.get('about.html'));
 assert.ok(about.includes('data-observanda-logos="project:'+projectId+'"><img src="'+project+'" alt="Apiary project"></div>'));assert.ok(!about.includes(home),'A Logos block replaces the automatic place');
 assert.ok(files.has(home)&&files.has(project)&&files.has(LOGOS_STYLESHEET));assert.ok(!files.has('logos/'+other.id+'.'+other.extension));
 const inventory=await store.publicationInventory(websiteId);
 for(const name of [home,project,LOGOS_STYLESHEET])assert.ok(inventory.files.includes(name),name);
 // Previewing the saved website shows the same page; only branding logos are served.
 const previewed=await store.file(websiteId,'index.html',{revision:exported.revision});
 assert.equal(previewed.content.toString('utf8'),await text(files.get('index.html')));
 assert.equal((await store.file(websiteId,home,{revision:exported.revision})).contentType,homeLogo.mime);
 await assert.rejects(store.file(websiteId,'logos/'+other.id+'.'+other.extension,{revision:exported.revision}),{code:'NOT_FOUND'});
 // The editor keeps the authored page: logos are never saved into it.
 assert.ok(!(await text((await store.file(websiteId,'index.html',{revision:exported.revision,editor:true})).content)).includes('site-logos'));
});

test('a page\'s own logos come first in its automatic place and their template is never published',()=>{
 const id=randomUUID(),names=new Map([[id,'logos/'+id+'.png']]),logos={auto:[{id,alt:'Branding'}]};
 const own='<template '+PAGE_LOGOS_ATTRIBUTE+'=""><img src="../pictures/a.png" alt="Station &quot;mark&quot;"><img src="../pictures/b.png"></template>';
 const plain='<html><head><title>A</title>'+own+'</head><body><main><p>Text</p></main></body></html>';
 const top=applyPageLogos(plain,'guide/a.html',{logos,names});
 assert.equal(top.html,'<html><head><title>A</title><link rel="stylesheet" href="../website-logos.css"></head><body><div class="site-logos" data-observanda-logos="auto"><img src="../pictures/a.png" alt="Station &quot;mark&quot;"><img src="../pictures/b.png" alt=""></div><main><p>Text</p></main></body></html>');
 assert.deepEqual([...top.used],[]);
 // A Logos block set to this page shows them; one set to the website still shows Branding.
 const blocks='<html><head>'+own+'</head><body><div class="site-logos" data-observanda-logos="auto"></div><div class="site-logos" data-observanda-logos="home"></div></body></html>';
 const filled=applyPageLogos(blocks,'guide/a.html',{logos:{...logos,home:[{id,alt:'Website'}]},names}).html;
 assert.ok(filled.includes('data-observanda-logos="auto"><img src="../pictures/a.png"')&&filled.includes('data-observanda-logos="home"><img src="../logos/'+id+'.png" alt="Website">')&&!filled.includes('<template'));
 // An empty template is removed and adds nothing else.
 assert.equal(applyPageLogos('<html><head><template '+PAGE_LOGOS_ATTRIBUTE+'=""></template></head><body></body></html>','a.html',{logos:{auto:[]},names}).html,'<html><head></head><body></body></html>');
});

test('page logos saved in the website editor publish and preview without research storage',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-page-logos-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{key:randomBytes(32),id:randomUUID()});
 const store=new WebsiteFileStore(workspace),id=randomUUID(),created=await store.create({id,name:'Field station'});
 const png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url)),picture='pictures/'+randomUUID()+'.png';
 const html='<!doctype html><html><head><title>Home</title><template '+PAGE_LOGOS_ATTRIBUTE+'=""><img src="'+picture+'" alt="Station mark"></template></head><body><main><h1>Home</h1></main></body></html>';
 const saved=await store.save(id,{expectedRevision:created.site.revision,path:'index.html',html,css:'',receivePictures:async function*(){yield {name:picture,bytes:png};}});
 const exported=await store.export(id,{expectedRevision:saved.site.revision}),page=await text(exported.files.get('index.html'));
 assert.ok(page.includes('<body><div class="site-logos" data-observanda-logos="auto"><img src="'+picture+'" alt="Station mark"></div><main>'),page);
 assert.ok(!page.includes('<template')&&exported.files.has(picture)&&exported.files.has(LOGOS_STYLESHEET));
 assert.ok((await store.publicationInventory(id)).files.includes(LOGOS_STYLESHEET));
 assert.equal((await store.file(id,'index.html',{revision:saved.site.revision})).content.toString('utf8'),page);
 assert.ok((await text((await store.file(id,'index.html',{revision:saved.site.revision,editor:true})).content)).includes('<template '+PAGE_LOGOS_ATTRIBUTE));
 // Removing the page's logos retires their picture.
 const cleared=await store.save(id,{expectedRevision:saved.site.revision,path:'index.html',html:html.replace(/<template[\s\S]*<\/template>/,''),css:''});
 const after=(await store.export(id,{expectedRevision:cleared.site.revision})).files;
 assert.ok(!after.has(picture)&&!after.has(LOGOS_STYLESHEET));
});
