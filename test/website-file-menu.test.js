import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {readWebsiteMenu} from '../src/website-file-menu.js';
import {contentBuffer} from '../src/file-content.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-menu-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Website menu opened a research database');
 return {store:new WebsiteFileStore(workspace),id:randomUUID(),workspace};
}
const item=(label,href,children=[])=>({key:null,label,href,children});
test('shared saved navigation preserves custom markup, nesting, page-relative links and an atomic site revision',async t=>{
 const {store,id}=await fixture(t),sub='pages/team.html';
 const page=prefix=>'<!doctype html><html><head><title>Team</title></head><body><div class="site-top"><a class="brand" href="'+prefix+'index.html">Lab</a><nav aria-label="Website"><ul class="site-menu custom"><li class="original"><a class="author" href="'+prefix+'index.html"><strong>Home</strong></a><details class="site-submenu"><summary>▼</summary><ul class="site-menu"><li><a href="'+prefix+sub+'">Team</a></li></ul></details></li></ul><a data-book-index href="'+prefix+'browse.html">Browse</a></nav></div><main>Unrelated &amp; intact</main><nav class="page-contents"><a href="#notes">Notes</a></nav></body></html>';
 const home=await store.importFiles(id,{name:'Lab',files:new Map([['index.html',page('')],[sub,page('../')],['browse.html','<html><body><main>Browse</main></body></html>'],['style.css','.author{color:red}']])});
 const before=home.site.revision,model=await store.menu(id,{expectedRevision:before}),[original,browse]=model.items;
 assert.equal(browse.label,'Browse');
 assert.equal(original.children[0].href,sub);
 const child=original.children.pop();child.label='Researchers';original.label='Home page';original.children.push(item('Methods','#methods'));
 const saved=await store.saveMenu(id,{expectedRevision:before,path:sub,items:[child,original,browse]});
 assert.notEqual(saved.site.revision,before);assert.match(saved.html,/<a class="author" href="\.\.\/index.html"[^>]*><strong>Home page<\/strong>/);
 assert.match(saved.html,/<li class="original">/);assert.match(saved.html,/<main>Unrelated &amp; intact<\/main>/);assert.match(saved.html,/<nav class="page-contents">/);
 assert.match(saved.html,/<\/ul><a data-book-index="" href="\.\.\/browse.html">Browse<\/a><\/nav>/);
 const normalized=readWebsiteMenu(saved.html,sub).items;assert.deepEqual(normalized.map(i=>i.label),['Researchers','Home page','Browse']);assert.equal(normalized[1].children[0].href,'#methods');
 await assert.rejects(store.saveMenu(id,{expectedRevision:before,items:[]}),{code:'CONFLICT'});
 const created=await store.save(id,{expectedRevision:saved.site.revision,path:'more/new.html',html:'<html><body><main><h1>New</h1></main></body></html>',css:'.author{color:red}'});
 assert.match(created.html,/href="\.\.\/pages\/team.html"/);assert.equal(readWebsiteMenu(created.html,'more/new.html').items[0].label,'Researchers');
 const exported=await store.export(id,{expectedRevision:created.site.revision});
 for(const filename of ['index.html',sub,'browse.html','more/new.html']){
  const html=(await contentBuffer(exported.files.get(filename))).toString('utf8');
  assert.deepEqual(readWebsiteMenu(html,filename).items.map(i=>i.label),['Researchers','Home page','Browse']);
 }
 const revision=created.site.revision;
 for(const href of ['../escape','javascript:alert(1)','/api/security','missing.html']){
  await assert.rejects(store.saveMenu(id,{expectedRevision:revision,items:[item('Invalid',href)]}));
 }
 assert.equal(await store.siteVersion(id),revision);
});
test('shared menu links to converted entry pages follow withdrawal and regrant without authoring stale content',async t=>{
 const {store,id,workspace}=await fixture(t),target='entries/'+randomUUID()+'.html',sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
 const source=async(title,visible=true)=>store.putSource({sourceId,title,visible,html:visible?'<h2 data-observanda-part="title">'+title+'</h2>':''},{token:await store.beginSourceUpdate({sourceId})});
 const approved=await source('Permitted observation');
 const home=await store.importFiles(id,{name:'Lab',files:new Map([
  ['index.html','<html><body><main>Welcome</main></body></html>'],['style.css',''],
  [target,'<html><head><title data-observanda-source="'+sourceId+'" data-observanda-source-revision="'+approved.revision+'" data-observanda-view="document-title">Permitted observation</title></head><body><main>Entry</main></body></html>']
 ]),draftFiles:new Map([['private.html','<html><body>Private</body></html>'],['draft-styles.css','']])});
 await assert.rejects(store.saveMenu(id,{expectedRevision:home.site.revision,items:[item('Private','private.html')]}),{code:'INVALID'});
 const shared=await store.saveMenu(id,{expectedRevision:home.site.revision,items:[item('Permitted observation',target,[item('Home','index.html')])]});
 assert.match(shared.html,/data-observanda-link=/);assert.doesNotMatch(shared.html,/aria-label="Pages under/);
 await source('Withdrawn',false);
 const denied=await store.open(id);assert.doesNotMatch(denied.html,/Permitted observation|href="entries\//);
 const blocked=await store.menu(id,{expectedRevision:denied.site.revision});assert.equal(blocked.items[0].blocked,true);assert.equal(blocked.items[0].href,'');
 await assert.rejects(store.saveMenu(id,{expectedRevision:shared.site.revision,items:[]}),{code:'CONFLICT'});
 await assert.rejects(store.saveMenu(id,{expectedRevision:denied.site.revision,items:[{...item('Injected',target),blocked:true}]}),{code:'CONFLICT'});
 const newPage=await store.save(id,{expectedRevision:denied.site.revision,path:'another.html',css:'',html:'<html><body><main>New</main></body></html>'});
 assert.doesNotMatch(newPage.html,/Permitted observation|href="entries\//);
 await source('Newly public');
 const restored=await store.open(id,{path:'another.html'});assert.match(restored.html,/Newly public/);assert.ok(restored.html.includes('href="'+target+'"'));
 const pending=await store.beginSourceUpdate({sourceId});await assert.rejects(store.menu(id,{expectedRevision:restored.site.revision}),{code:'CONFLICT'});await store.cancelSourceUpdate({sourceId,token:pending});
});

test('public menu pictures are inherited on nested pages, retained in drafts and retired after their last use',async t=>{
 const {store,id}=await fixture(t),picture='pictures/'+'a'.repeat(64)+'.png',doc='<html><body><main>Page</main></body></html>';
 const start=await store.importFiles(id,{name:'Images',files:new Map([['index.html',doc],['style.css','']]),draftFiles:new Map([['draft.html',doc],['draft-styles.css','']])});
 const image='<nav aria-label="Website"><a href="index.html"><img alt="Logo" src="'+picture+'">Home</a></nav>';
 const withPhoto=await store.save(id,{...start,html:doc.replace('<main>',image+'<main>'),expectedRevision:start.site.revision,receivePictures:async function*(){yield {name:picture,bytes:Buffer.from('menu picture')};}});
 const added=await store.save(id,{path:'other/place.html',html:doc,css:'',expectedRevision:withPhoto.site.revision});
 const {items}=await store.menu(id,{expectedRevision:added.site.revision});items[0].label='Welcome';
 const shared=await store.saveMenu(id,{items,expectedRevision:added.site.revision});
 assert.match((await store.open(id,{path:'other/place.html'})).html,/src="\.\.\/pictures\//);
 assert.ok((await store.export(id)).files.has(picture));
 const draft=await store.open(id,{path:'draft.html'});assert.match(draft.html,/src="pictures\//);
 await store.saveMenu(id,{items:[],expectedRevision:shared.site.revision});assert.ok(!(await store.export(id)).files.has(picture));
});
