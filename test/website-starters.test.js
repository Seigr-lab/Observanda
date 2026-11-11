import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {WEBSITE_STARTERS,STARTER_IDS,starterText} from '../src/website-starters.js';
import {regionOperation} from '../src/website-region-storage.js';
import {contentBuffer} from '../src/file-content.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-starters-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,force:true,maxRetries:8});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 return new WebsiteFileStore(workspace);
}

test('every starter catalogue text exists in every language',async()=>{
 const english=await starterText('en');
 for(const language of ['ca','es','nb','nn']){
  const text=await starterText(language);
  assert.deepEqual(Object.keys(text).sort(),Object.keys(english).sort(),language);
  assert.notEqual(text.starterHome,english.starterHome,language);
 }
 assert.equal((await starterText('pt-BR')).starterHome,english.starterHome);
});

for(const id of STARTER_IDS){
 test('the '+id+' starter creates a complete, publishable website',async t=>{
  const store=await fixture(t),starter=WEBSITE_STARTERS[id];
  const state=await store.create({name:'Bee yard',language:'en',starter:id});
  const site=state.site,paths=site.pages.map(page=>page.path).sort();
  assert.deepEqual(paths,starter.pages.map(page=>page.path).sort());
  const home=await store.open(site.id,{path:'index.html'});
  assert.match(home.html,/<h1>Bee yard<\/h1>/);
  if(starter.menu){
   const menu=await store.menu(site.id,{expectedRevision:site.revision});
   assert.deepEqual(menu.items.map(item=>item.href),starter.menu.map(([href])=>href));
   for(const page of starter.pages)assert.match((await store.open(site.id,{path:page.path})).html,/<nav[^>]*data-website-menu/,page.path);
  }
  const regions=await regionOperation(store,'list',site.id,{expectedRevision:site.revision});
  assert.deepEqual(regions.page.map(row=>row.slot),Object.keys(starter.regions??{}).sort((a,b)=>['header','sidebar','secondary-sidebar','footer'].indexOf(a)-['header','sidebar','secondary-sidebar','footer'].indexOf(b)));
  for(const page of starter.pages){
   const html=(await store.open(site.id,{path:page.path})).html;
   if(page.feed)assert.match(html,/data-website-feed=/,page.path);
   for(const href of html.matchAll(/<a href="([^"#:]+)"/g)){
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(page.path),href[1]));
    assert.ok(paths.includes(target),page.path+' links to '+href[1]);
   }
  }
  const exported=await store.export(site.id,{expectedRevision:site.revision});
  assert.ok(exported.files.has('index.html'));
  if(starter.regions)assert.match((await contentBuffer(exported.files.get('website-regions.css'))).toString(),/data-website-region/);
 });
}

test('a starter writes its content in the site language and refuses unknown starters',async t=>{
 const store=await fixture(t);
 const state=await store.create({name:'Rusc',language:'ca',starter:'course'});
 const lesson=await store.open(state.site.id,{path:'lessons/lesson-2.html'});
 assert.match(lesson.html,/<html lang="ca">/);assert.match(lesson.html,/<h1>Lliçó 2<\/h1>/);
 assert.match(lesson.html,/<a href="lesson-1.html">Lliçó anterior<\/a>/);
 assert.match(lesson.html,/<details data-website-region-toggle="" open=""><summary>Lliçons<\/summary>/);
 await assert.rejects(store.create({name:'X',starter:'unknown'}),{code:'INVALID'});
 const blank=await store.create({name:'Plain',starter:'blank'});
 assert.deepEqual(blank.site.pages.map(page=>page.path),['index.html']);
});
