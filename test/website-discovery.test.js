import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {websiteFilesHttp} from '../src/website-files-http.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {contentBuffer} from '../src/file-content.js';
import {normalizeBaseUrl} from '../src/website-discovery-settings.js';
import {publicPageURL} from '../src/website-discovery-output.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-discovery-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Discovery settings opened the research catalogue');
 const store=new WebsiteFileStore(workspace);
 const request=async(operation,data={})=>{let answer;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL('/api/website-files/'+operation,'http://localhost'),body:async()=>data,check:async()=>{},json:value=>{answer=value;}});return answer;};
 return {store,request};
}
const text=async content=>(await contentBuffer(content)).toString('utf8');

test('a bilingual site in a subdirectory publishes canonical, language, social and sitemap declarations for public pages only',async t=>{
 const {store,request}=await fixture(t);
 const created=await request('create',{name:'Estuary atlas',language:'en'}),siteId=created.site.id;
 const call=(operation,data)=>request(operation,{siteId,...data});
 const picture='pictures/'+randomUUID()+'.png',png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
 let state=await store.save(siteId,{expectedRevision:created.site.revision,path:'index.html',html:created.html.replace('</main>','<img src="'+picture+'" alt="Estuary at dawn"></main>').replace('</head>','<meta name="description" content="Field notes from the estuary">\n</head>'),css:'',receivePictures:async function*(){yield {name:picture,bytes:png};}});
 state=await call('page/create',{expectedRevision:state.site.revision,path:'ca/index.html',title:'Atles de l’estuari',language:'ca',inclusion:'included'});
 state=await call('page/create',{expectedRevision:state.site.revision,path:'draft.html',title:'Unpublished draft canary',language:'en'});
 const authoredHome=(await store.open(siteId,{path:'index.html'})).html;

 // Settings are validated declarations; they never include remote resources.
 for(const baseUrl of ['ftp://example.org/','https://user:secret@example.org/','https://example.org/?q=1','https://example.org/#top','/atlas/'])
  await assert.rejects(call('discovery/save',{expectedRevision:state.site.revision,settings:{baseUrl,indexing:true,sitemap:true,socialImage:null,socialImageAlt:''}}),{code:'INVALID'});
 await assert.rejects(call('discovery/save',{expectedRevision:state.site.revision,settings:{baseUrl:null,indexing:true,sitemap:true,socialImage:'pictures/missing.png',socialImageAlt:''}}),{code:'INVALID'});
 assert.equal(normalizeBaseUrl('https://example.org/atlas'),'https://example.org/atlas/');
 let saved=await call('discovery/save',{expectedRevision:state.site.revision,settings:{baseUrl:'https://example.org/atlas',indexing:true,sitemap:true,socialImage:picture,socialImageAlt:'Estuary at dawn'}});
 assert.equal(saved.discovery.settings.baseUrl,'https://example.org/atlas/');
 const home=saved.discovery.pages.find(page=>page.path==='index.html');
 saved=await call('discovery/save',{expectedRevision:saved.site.revision,path:'ca/index.html',translation:{of:home.pageId,status:'outdated'}});
 assert.deepEqual(saved.discovery.group.map(row=>[row.path,row.language,row.source,row.outdated]),[['index.html','en',true,false],['ca/index.html','ca',false,true]]);
 assert.equal((await store.open(siteId,{path:'index.html'})).html,authoredHome,'Settings never rewrite authored pages');

 const {files}=await store.export(siteId,{expectedRevision:saved.site.revision});
 assert.ok(!files.has('draft.html'));assert.ok(!files.has('robots.txt'),'robots.txt is only meaningful at a host root');
 const published=await text(files.get('index.html'));
 assert.equal(published.replace(/<link rel="canonical"[\s\S]*?<meta name="twitter:card"[^>]*>\n/,''),authoredHome,'Only a generated head block is added');
 assert.match(published,/<link rel="canonical" href="https:\/\/example\.org\/atlas\/">/);
 assert.match(published,/<link rel="alternate" hreflang="ca" href="https:\/\/example\.org\/atlas\/ca\/">/);
 assert.match(published,/<link rel="alternate" hreflang="x-default" href="https:\/\/example\.org\/atlas\/">/);
 assert.match(published,/<meta property="og:description" content="Field notes from the estuary">/);
 assert.match(published,new RegExp('<meta property="og:image" content="https://example\\.org/atlas/'+picture.replace('.','\\.')+'">'));
 assert.match(published,/<meta name="twitter:card" content="summary_large_image">/);
 const catalan=await text(files.get('ca/index.html'));
 assert.match(catalan,/<link rel="canonical" href="https:\/\/example\.org\/atlas\/ca\/">/);assert.match(catalan,/<meta property="og:locale" content="ca">/);
 const sitemap=await text(files.get('sitemap.xml'));
 assert.match(sitemap,/<loc>https:\/\/example\.org\/atlas\/<\/loc>/);assert.match(sitemap,/<loc>https:\/\/example\.org\/atlas\/ca\/<\/loc>/);
 assert.match(sitemap,/<xhtml:link rel="alternate" hreflang="ca" href="https:\/\/example\.org\/atlas\/ca\/"\/>/);
 for(const [name,content] of files)if(/\.(?:html|xml|json)$/.test(name))assert.doesNotMatch(await text(content),/Unpublished draft canary|draft\.html/,name);
 const catalogue=await call('review/catalogue',{expectedRevision:saved.site.revision});assert.ok(catalogue.files.includes('sitemap.xml'));

 // A site at a host root also receives robots.txt; without indexing, pages
 // ask not to be indexed and no sitemap is offered.
 saved=await call('discovery/save',{expectedRevision:saved.site.revision,settings:{baseUrl:'https://atlas.example.org/',indexing:false,sitemap:true,socialImage:null,socialImageAlt:''}});
 const closed=(await store.export(siteId,{expectedRevision:saved.site.revision})).files;
 assert.equal(await text(closed.get('robots.txt')),'User-agent: *\nDisallow: /\n');assert.ok(!closed.has('sitemap.xml'));
 assert.match(await text(closed.get('index.html')),/<meta name="robots" content="noindex">/);
 saved=await call('discovery/save',{expectedRevision:saved.site.revision,settings:{baseUrl:'https://atlas.example.org/',indexing:true,sitemap:true,socialImage:null,socialImageAlt:''}});
 assert.equal(await text((await store.export(siteId,{expectedRevision:saved.site.revision})).files.get('robots.txt')),'User-agent: *\nAllow: /\n\nSitemap: https://atlas.example.org/sitemap.xml\n');

 // Leaving a translation group and clearing settings returns the site to
 // byte-identical publication of the authored files.
 saved=await call('discovery/save',{expectedRevision:saved.site.revision,path:'ca/index.html',translation:{of:null}});assert.deepEqual(saved.discovery.group,[]);
 saved=await call('discovery/save',{expectedRevision:saved.site.revision,settings:{baseUrl:null,indexing:true,sitemap:true,socialImage:null,socialImageAlt:''}});
 assert.equal(await text((await store.export(siteId,{expectedRevision:saved.site.revision})).files.get('index.html')),authoredHome);

 // Authored HTML policy is unchanged: absolute metadata links stay generated declarations.
 await assert.rejects(store.save(siteId,{expectedRevision:saved.site.revision,path:'index.html',html:authoredHome.replace('</head>','<link rel="canonical" href="https://elsewhere.example/">\n</head>'),css:''}),{code:'INVALID'});
});

test('public addresses use directory form for index pages and encode path segments',()=>{
 assert.equal(publicPageURL('https://example.org/atlas/','index.html'),'https://example.org/atlas/');
 assert.equal(publicPageURL('https://example.org/atlas/','methods/index.html'),'https://example.org/atlas/methods/');
 assert.equal(publicPageURL('https://example.org/','notes/field day.html'),'https://example.org/notes/field%20day.html');
});
