import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {componentOperation} from '../src/website-component-storage.js';
import {regionOperation} from '../src/website-region-storage.js';
import {changeRegions,checkRegions,regionSettings,resolveRegions} from '../src/website-region-model.js';
import {regionStylesheet} from '../src/website-region-markup.js';
import {PUBLIC_REGIONS_SCRIPT} from '../src/public-regions.js';
import {contentBuffer} from '../src/file-content.js';

const id1='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222';
const site={components:[{id:id1,name:'Banner'},{id:id2,name:'Notes'}]};

test('regions resolve from the site, the deepest folder and the page, and null leaves a slot empty',()=>{
 let regions=changeRegions(site,{slot:'header',component:id1});
 regions=changeRegions({...site,regions},{slot:'sidebar',component:id2,settings:{width:300}});
 regions=changeRegions({...site,regions},{slot:'header',scope:'folder',path:'notes',component:id2});
 regions=changeRegions({...site,regions},{slot:'header',scope:'folder',path:'notes/deep',component:null});
 regions=changeRegions({...site,regions},{slot:'sidebar',scope:'page',path:'notes/a.html',component:null});
 const manifest={...site,regions};checkRegions(manifest);
 const slots=page=>resolveRegions(manifest,page).map(r=>r.slot+':'+r.component.slice(0,1));
 assert.deepEqual(slots('index.html'),['header:1','sidebar:2']);
 assert.deepEqual(slots('notes/b.html'),['header:2','sidebar:2']);
 assert.deepEqual(slots('notes/a.html'),['header:2']);
 assert.deepEqual(slots('notes/deep/c.html'),['sidebar:2']);
 assert.equal(resolveRegions(manifest,'index.html')[1].settings.width,300);
 // Removing an override returns the folder to the site setting.
 const back=changeRegions(manifest,{slot:'header',scope:'folder',path:'notes'});
 assert.deepEqual(resolveRegions({...site,regions:back},'notes/b.html').map(r=>r.component),[id1,id2]);
});

test('region settings and stored regions are validated',()=>{
 assert.throws(()=>regionSettings('sidebar',{width:100}),{code:'INVALID'});
 assert.throws(()=>regionSettings('sidebar',{mobile:'collapsed'}),{code:'INVALID'});
 assert.throws(()=>regionSettings('sidebar',{background:'red'}),{code:'INVALID'});
 assert.throws(()=>regionSettings('footer',{surprise:true}),{code:'INVALID'});
 assert.equal(regionSettings('secondary-sidebar',{}).side,'right');
 assert.throws(()=>changeRegions(site,{slot:'header',component:randomUUID()}),{code:'NOT_FOUND'});
 assert.throws(()=>changeRegions(site,{slot:'header',scope:'folder',path:'../up',component:id1}),{code:'INVALID'});
 assert.throws(()=>checkRegions({...site,regions:{slots:{header:{component:id1,settings:{}}},overrides:[]}}),{code:'FORMAT'});
 assert.throws(()=>checkRegions({...site,regions:{slots:{},overrides:[{scope:'page',path:'a.html',slot:'nope',component:null}]}}),{code:'FORMAT'});
 const first=changeRegions(site,{slot:'sidebar',component:id1,settings:{side:'right',sticky:true,background:'#102030'}});
 const css=regionStylesheet(changeRegions({...site,regions:first},{slot:'secondary-sidebar',component:id2}).slots);
 assert.match(css,/\[data-website-region="sidebar"\] \{[^}]*grid-column: 4[^}]*inline-size: 260px[^}]*\}/);
 assert.match(css,/background: #102030/);assert.match(css,/position: sticky/);
 assert.match(css,/\[data-website-region="secondary-sidebar"\] \{[^}]*grid-column: 5/);
});

const page=body=>'<!doctype html><html><head><title>Site</title></head><body><main>'+body+'</main></body></html>';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-regions-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,force:true,maxRetries:8});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Regions opened research');
 const store=new WebsiteFileStore(workspace),id=randomUUID();
 const opened=await store.importFiles(id,{name:'Fixture',files:new Map([['index.html',page('<section><p>Site banner</p></section><p>Home</p>')],['notes/one.html',page('<p>One</p>')],['style.css','']]),
  draftFiles:new Map([['private.html',page('<section><p>Draft</p></section>')],['draft-styles.css','']])});
 const component=(name,revision,opts)=>componentOperation(store,name,id,{expectedRevision:revision,...opts});
 const region=(name,revision,opts)=>regionOperation(store,name,id,{expectedRevision:revision,...opts});
 return {store,id,opened,component,region};
}
const html=async(store,id,file)=>(await store.open(id,{path:file})).html;
const instanceId=text=>text.match(/data-website-instance="([^"]+)"/)[1];

test('a site region is written into every page, inherited by new pages, kept current by component updates and removable',async t=>{
 const {store,id,opened,component,region}=await fixture(t);
 let state=await component('create',opened.site.revision,{blockPath:'0/0',name:'Banner'});
 const banner=(await component('list',state.site.revision)).items[0];
 // Detach the capture so the banner only appears as a region.
 state=await component('detach',state.site.revision,{instance:instanceId(state.html)});
 state=await region('assign',state.site.revision,{slot:'header',component:banner.id});
 for(const name of ['index.html','notes/one.html','private.html']){
  const text=await html(store,id,name);
  assert.match(text,/<body><header data-website-region="header"><section data-website-instance="[^"]+"><p>Site banner<\/p><\/section><\/header><main>/,name);
  const up=name.startsWith('notes/')?'\\.\\./':'';
  assert.match(text,new RegExp('<link rel="stylesheet" href="'+up+'website-regions\\.css"><script defer src="'+up+'public-regions\\.js"></script></head>'),name);
 }
 const listed=await region('list',state.site.revision,{path:'notes/one.html'});
 assert.deepEqual(listed.page,[{slot:'header',component:banner.id,name:'Banner'}]);
 assert.equal(listed.slots.find(s=>s.slot==='header').name,'Banner');

 state=await store.createPage(id,{expectedRevision:state.site.revision,path:'notes/two.html',title:'Two'});
 assert.match(state.html,/<header data-website-region="header">.*Site banner/);

 // Saving a page keeps its region; editing inside the region is refused.
 const one=await store.open(id,{path:'notes/one.html'});
 state=await store.save(id,{expectedRevision:one.site.revision,path:'notes/one.html',html:one.html.replace('<p>One</p>','<p>One edited</p>'),css:''});
 assert.match(state.html,/data-website-region="header".*One edited/);
 await assert.rejects(store.save(id,{expectedRevision:state.site.revision,path:'notes/one.html',html:state.html.replace('Site banner','Rogue'),css:''}),{code:'CONFLICT'});
 await assert.rejects(component('detach',state.site.revision,{path:'notes/one.html',instance:instanceId(state.html)}),{code:'INVALID'});

 const main=await component('main',state.site.revision,{component:banner.id}),edited=main.html.replace('Site banner','New banner');
 const review=await component('review',state.site.revision,{component:banner.id,name:'Banner',html:edited});
 state=await component('update',state.site.revision,{component:banner.id,name:'Banner',html:edited,reviewId:review.reviewId});
 for(const name of ['index.html','notes/one.html','notes/two.html'])assert.match(await html(store,id,name),/New banner/,name);
 await assert.rejects(component('remove',state.site.revision,{component:banner.id}),{code:'INVALID'});

 const exported=await store.export(id,{expectedRevision:state.site.revision});
 const sheet=(await contentBuffer(exported.files.get('website-regions.css'))).toString();
 assert.match(sheet,/body > \[data-website-region="header"\]/);
 assert.equal((await contentBuffer(exported.files.get('public-regions.js'))).toString(),PUBLIC_REGIONS_SCRIPT);

 state=await region('assign',state.site.revision,{slot:'header',component:null});
 for(const name of ['index.html','notes/one.html','notes/two.html']){
  const text=await html(store,id,name);assert.doesNotMatch(text,/data-website-region|website-regions\.css|public-regions\.js/,name);
 }
 const after=await store.export(id,{expectedRevision:state.site.revision});
 assert.equal(after.files.has('website-regions.css'),false);assert.equal(after.files.has('public-regions.js'),false);
 await component('remove',state.site.revision,{component:banner.id});
});

test('folder and page overrides, collapsed phone regions and sidebars around the main content',async t=>{
 const {store,id,opened,component,region}=await fixture(t);
 let state=await component('create',opened.site.revision,{blockPath:'0/0',name:'Aside'});
 const aside=(await component('list',state.site.revision)).items[0];
 state=await component('detach',state.site.revision,{instance:instanceId(state.html)});
 state=await region('assign',state.site.revision,{slot:'sidebar',component:aside.id,settings:{mobile:'collapsed',mobileTitle:'Contents & more'}});
 let text=await html(store,id,'index.html');
 assert.match(text,/<aside data-website-region="sidebar"><details data-website-region-toggle="" open=""><summary>Contents &amp; more<\/summary><section data-website-instance="[^"]+">.*<\/section><\/details><\/aside><main>/);
 state=await region('assign',state.site.revision,{slot:'sidebar',scope:'folder',target:'notes',component:null});
 assert.doesNotMatch(await html(store,id,'notes/one.html'),/data-website-region/);
 assert.match(await html(store,id,'index.html'),/data-website-region="sidebar"/);
 state=await region('assign',state.site.revision,{slot:'secondary-sidebar',scope:'page',target:'notes/one.html',component:aside.id});
 text=await html(store,id,'notes/one.html');
 assert.match(text,/<\/main><aside data-website-region="secondary-sidebar"><section data-website-instance=/);
 assert.match(text,/href="\.\.\/website-regions\.css"/);
 // Removing the page override lets the folder setting apply again.
 state=await region('assign',state.site.revision,{slot:'secondary-sidebar',scope:'page',target:'notes/one.html'});
 assert.doesNotMatch(await html(store,id,'notes/one.html'),/data-website-region/);
 await assert.rejects(region('assign',state.site.revision,{slot:'header',scope:'page',target:'missing.html',component:aside.id}),{code:'NOT_FOUND'});
 await assert.rejects(region('assign',state.site.revision,{slot:'header',component:aside.id,settings:{width:9}}),{code:'INVALID'});
});

test('a draft component cannot fill a region shown on a public page',async t=>{
 const {store,id,opened,component,region}=await fixture(t);
 let state=await component('create',opened.site.revision,{path:'private.html',blockPath:'0/0',name:'Private'});
 const item=(await component('list',state.site.revision,{path:'private.html'})).items[0];
 await assert.rejects(region('assign',state.site.revision,{slot:'footer',component:item.id}),{code:'WEBSITE_PUBLIC_COMPONENT'});
 state=await region('assign',state.site.revision,{slot:'footer',scope:'page',target:'private.html',component:item.id,path:'private.html'});
 assert.match(await html(store,id,'private.html'),/<footer data-website-region="footer">/);
 assert.doesNotMatch(await html(store,id,'index.html'),/data-website-region/);
});

test('a page made from a page design receives the site regions once, not a copy of the source page region',async t=>{
 const {store,id,opened,component,region}=await fixture(t);
 const {websitePageDesigns}=await import('../src/website-page-designs.js');
 // A page without a main element is designed from its whole body, where a sidebar region sits.
 let state=await store.createPage(id,{expectedRevision:opened.site.revision,path:'plain.html',title:'Plain',inclusion:'included'});
 const plain=await store.open(id,{path:'plain.html'});
 state=await store.save(id,{expectedRevision:plain.site.revision,path:'plain.html',html:plain.html.replace(/<main>(.*)<\/main>/s,'$1<p>Body text</p>'),css:''});
 state=await component('create',state.site.revision,{blockPath:'0/0',name:'Banner'});
 const banner=(await component('list',state.site.revision)).items[0];
 state=await component('detach',state.site.revision,{instance:instanceId(state.html)});
 state=await region('assign',state.site.revision,{slot:'sidebar',component:banner.id,settings:{mobile:'collapsed',mobileTitle:'More'}});
 assert.doesNotMatch(await html(store,id,'plain.html'),/<main>/);
 state=await websitePageDesigns(store,id,{action:'name',path:'plain.html',expectedRevision:state.site.revision,name:'Plain layout'});
 const {items:[design]}=await websitePageDesigns(store,id,{action:'list',path:'plain.html',expectedRevision:state.site.revision});
 state=await websitePageDesigns(store,id,{action:'use',path:'plain.html',expectedRevision:state.site.revision,design:design.id,title:'From design',destination:'designed.html',inclusion:'included',labels:{text:'Text',heading:'Heading',image:'Image'}});
 const text=await html(store,id,'designed.html');
 assert.equal(text.match(/data-website-region=/g).length,1,text);
 assert.equal(text.match(/<summary>/g).length,1,text);
});

test('section themes and page tools cannot target a region wrapper',async t=>{
 const {store,id,opened,component,region}=await fixture(t);
 const {websiteThemes}=await import('../src/website-scoped-themes.js');
 let state=await component('create',opened.site.revision,{blockPath:'0/0',name:'Banner'});
 const banner=(await component('list',state.site.revision)).items[0];
 state=await component('detach',state.site.revision,{instance:instanceId(state.html)});
 state=await region('assign',state.site.revision,{slot:'header',component:banner.id});
 state=await websiteThemes(store,id,{expectedRevision:state.site.revision,path:'index.html',action:'create',name:'Dark',values:{background:'#101010'},scope:'library'},true);
 await assert.rejects(websiteThemes(store,id,{expectedRevision:state.site.revision,path:'index.html',action:'apply',themeId:state.themeId,scope:'section',blockPath:'0'},true),{code:'INVALID'});
 await assert.rejects(component('insert',state.site.revision,{component:banner.id,blockPath:'0/0',position:'before'}),{code:'INVALID'});
});
