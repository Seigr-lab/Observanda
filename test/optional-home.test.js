import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNotebook,upgradeNotebook,validateNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {hasHomepage,layoutTargets} from '../src/web/website-layouts.js';
import {websiteSummary,navigationItems,homeIntroduction} from '../src/web/website-model.js';

test('new websites have no homepage; legacy websites retain authored content under the Home identity',()=>{
 const book=createNotebook('Collective','Workspace description');
 assert.equal(hasHomepage(book),false);assert.deepEqual(layoutTargets(book),[]);
 assert.equal(websiteSummary(book).canPublish,false);assert.deepEqual(navigationItems(book),[]);
 assert.equal(buildPublication(book).files.has('index.html'),false);
 const old=sampleNotebook();old.formatVersion=17;old.website.title='Collective';
 const before=structuredClone(old),next=upgradeNotebook(old);
 assert.deepEqual(old,before);assert.deepEqual(next.website.home,old.website.home);
 assert.equal(hasHomepage(next),true);assert.equal(layoutTargets(next)[0].title,'Home');
 assert.equal(buildPublication(next).pages[0].title,'Home');
 assert.equal(homeIntroduction(next),old.description);
});

test('an explicitly created homepage has independent heading and introduction',()=>{
 const book=createNotebook('Collective','Workspace description');
 Object.assign(book.website.home,{enabled:true,title:'Welcome',introduction:'About the work'});
 book.website.title='Public identity';book.website.description='Site description';
 assert.doesNotThrow(()=>validateNotebook(book));assert.equal(websiteSummary(book).canPublish,true);
 const result=buildPublication(book),html=result.files.get('index.html');
 assert.match(html,/<h1>Welcome<\/h1>/);assert.match(html,/About the work/);
 assert.match(html,/Public identity/);assert.doesNotMatch(html,/Workspace description|Site description/);
 assert.equal(result.defaultPage,'index.html');assert.equal(result.pages[0].title,'Home');
 const invalid=structuredClone(book);invalid.website.home.enabled='yes';assert.throws(()=>validateNotebook(invalid));
});

test('no-home publication excludes homepage data and media before rendering and retains relative navigation',()=>{
 const book=sampleNotebook(),assetId=randomUUID();
 book.website.home={enabled:false,title:'PRIVATE_HOME_TITLE',introduction:'PRIVATE_HOME_INTRODUCTION',showTitle:true,sections:[
 {id:'secret',kind:'asset',title:'PRIVATE_HOME_ASSET',assetId,show:true}
 ]};
 book.website.assets.push({id:assetId,kind:'image',caption:'PRIVATE_ASSET_CAPTION',alt:'Secret',transcript:''});
 book.website.navigation=[{target:'home',label:'PRIVATE_MENU',show:true}];
 book.pages.push({id:randomUUID(),title:'About the work',body:'A public page',share:true,sections:[
 {id:'home-link',kind:'link',title:'PRIVATE_HOME_LINK',href:'home',label:'Go home',body:'',show:true}
 ]});
 const projected=publicProjection(book);
 assert.deepEqual(projected.website.assets,[]);
 assert.equal(projected.website.navigation.some(n=>n.target==='home'),false);
 const result=buildPublication(book,{blockedValues:['PRIVATE_HOME','PRIVATE_ASSET','PRIVATE_MENU']});
 assert.equal(result.files.has('index.html'),false);
 assert.equal(result.defaultPage,'projects/'+book.projects[0].id+'.html');
 for(const [name,html] of result.files){
  if(!name.endsWith('.html'))continue;
  assert.doesNotMatch(html,/index\.html|PRIVATE_/);
  const base=new URL('https://example.test/existing/section/'+name);
  for(const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)){
   const target=new URL(match[1],base);
   if(target.origin!==base.origin)continue;
   assert.ok(target.pathname.startsWith('/existing/section/'));
   assert.ok(result.files.has(target.pathname.slice('/existing/section/'.length)),match[1]);
  }
 }
});

test('a standalone custom page publishes without a homepage or project',()=>{
 const book=createNotebook('Collective');
 const page={id:randomUUID(),title:'Listening notes',body:'An independent edition',share:true,sections:[]};book.pages.push(page);
 const result=buildPublication(book);
 assert.equal(result.defaultPage,'pages/'+page.id+'.html');
 assert.deepEqual(result.pages,[{title:page.title,path:result.defaultPage}]);
 assert.equal(websiteSummary(book).canPublish,true);
 assert.deepEqual(navigationItems(book).map(n=>n.label),[page.title]);
});
