import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {authoredPageVersion,renderPageVersion} from '../src/website-version-document.js';
import {websiteVersions} from '../src/website-versions.js';
import {restoreWebsitePageVersion} from '../src/website-version-restore.js';
import {websiteVersionDesign} from '../src/website-version-design.js';
import {componentOperation} from '../src/website-component-storage.js';
import {websiteThemes} from '../src/website-scoped-themes.js';
import {pageInclusion} from '../src/website-page-inclusion.js';
import {contentBuffer} from '../src/file-content.js';
import {maxNamed,maxVersions,retainedVersionFiles} from '../src/website-version-retention.js';
import {saveWebsiteRecovery,websiteRecoveryResource} from '../src/website-recovery.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'website-versions-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Version history opened a research store');
 const actor={kind:'user',label:'Website author'},open=()=>new WebsiteFileStore(workspace,{actor});
 return {id:randomUUID(),workspace,open};
}
test('archived page bytes contain only author work and use unambiguous current placements',()=>{
 const wrap=(key,value)=>'<article data-observanda-source="'+key+'">'+value+'</article>';
 const original='<p>Author</p>'+wrap('repeated','Private phrase')+wrap('repeated','Shared phrase')+'<template>'+wrap('nested','Retired title')+'</template><img src="files/figure.png" alt="Research figure">';
 const governed=new Set(['files/figure.png']),version=authoredPageVersion(original,'index.html',governed);
 assert.doesNotMatch(JSON.stringify(version),/Private phrase|Shared phrase|Retired title|Research figure|figure.png/);
 const now=wrap('repeated','Current phrase')+wrap('repeated','Shared phrase');
 const result=renderPageVersion(version,now,'index.html',governed);
 assert.equal(result.unavailable,3);assert.equal(result.currentOnly,1);assert.match(result.html,/Shared phrase/);
 assert.doesNotMatch(result.html,/Private phrase|Current phrase|Retired title|Research figure/);
});
test('a named authored revision survives reopening and older source regions compare using present permission',async t=>{
 const {id,workspace,open}=await fixture(t);let store=open();
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
 const put=async(title,visible)=>store.putSource({sourceId,title,visible,html:visible?'<p>'+title+'</p>':''},{token:await store.beginSourceUpdate({sourceId})});
 const source=await put('Withdrawn findings',true);
 let active=await store.create({id,name:'Version study'});active=await store.insertSources(id,{expectedRevision:active.site.revision,sources:[{sourceId,sourceRevision:source.revision}],position:{before:0}});
 active=await store.save(id,{...active,expectedRevision:active.site.revision,html:active.html.replace('</main>','<p>Original authored section</p></main>'),css:'main{color:navy}'});
 active=await websiteVersions(store,id,'name',{expectedRevision:active.site.revision,label:'Signoff'});
 const named=(await websiteVersions(store,id,'list',{expectedRevision:active.site.revision})).items.find(e=>e.label==='Signoff');
 const original=await store.scope(async()=>(await store.raw(id)).files.find(f=>f.name==='index.html').blob);
 assert.deepEqual(named.actor,{kind:'user',label:'Website author'});assert.ok(Date.parse(named.at));
 active=await store.save(id,{...active,expectedRevision:active.site.revision,html:active.html.replace('Original authored section','New authored section'),css:'main{color:teal}'});
 await put('Withdrawn findings',false);
 store=open();active=await store.open(id);
 await assert.rejects(stat(store.absolute(original)),{code:'ENOENT'});
 const compared=await websiteVersions(store,id,'compare',{expectedRevision:active.site.revision,version:named.id});
 assert.match(compared.difference.before,/Original authored section/);assert.match(compared.difference.after,/New authored section/);
 const styles=await websiteVersions(store,id,'compare',{expectedRevision:active.site.revision,version:named.id,area:'css'});
 assert.equal(styles.difference.before,'main{color:navy}');assert.equal(styles.difference.after,'main{color:teal}');
 assert.doesNotMatch(JSON.stringify(compared),/Withdrawn findings/);assert.ok(compared.updated+compared.unavailable>0);
 const request={expectedRevision:active.site.revision,version:named.id,path:'index.html'};
 const review=await restoreWebsitePageVersion(store,id,request);
 assert.equal(review.status,'ready');
 assert.ok(review.items.some(r=>Number.isInteger(r.position)&&r.kind==='source'&&r.reason==='updatedGrant'),JSON.stringify(review.items));
 await assert.rejects(restoreWebsitePageVersion(store,id,{...request,reviewId:'0'.repeat(64)},true),{code:'CONFLICT'});
 active=await restoreWebsitePageVersion(store,id,{...request,reviewId:review.reviewId},true);
 assert.notEqual(active.site.revision,request.expectedRevision);assert.match(active.html,/Original authored section/);
 assert.doesNotMatch(active.html,/Withdrawn findings/);assert.equal(active.css,'main{color:navy}');
 const recent=(await websiteVersions(store,id,'list',{expectedRevision:active.site.revision})).items;
 assert.equal(recent[0].restoredFrom,named.id);
 active=await websiteVersions(store,id,'name',{expectedRevision:active.site.revision,label:'After withdrawal'});
 const after=(await websiteVersions(store,id,'list',{expectedRevision:active.site.revision})).items[0].id;
 const current=await websiteVersions(store,id,'compare',{expectedRevision:active.site.revision,version:after});
 assert.equal(current.updated,0);assert.equal(current.unavailable,0);
 const token=await store.beginSourceUpdate({sourceId});
 await assert.rejects(websiteVersions(store,id,'compare',{expectedRevision:active.site.revision,version:named.id}),{code:'CONFLICT'});
 await store.cancelSourceUpdate({sourceId,token});
});
test('interruption before or after the site head replacement recovers the visible version and collects abandoned manifests',async t=>{
 const {id,open}=await fixture(t);
 let store=open(),active=await store.create({id,name:'Interruptible atlas'});
 const directory='.observanda/website-files/sites/'+id,head=directory+'/head.json';
 for(const written of [false,true]){
  const old=active.site.revision,write=store.writeControl.bind(store);
  store.writeControl=async(name,...args)=>{
   if(name!==head)return write(name,...args);
   if(written)await write(name,...args);
   throw Object.assign(Error('Interrupted at the head'),{code:'EIO'});
  };
  await assert.rejects(store.save(id,{...active,expectedRevision:old,css:written?'h1{color:maroon}':'h1{color:green}'}),{code:'EIO'});
  store=open();active=await store.open(id);
  if(written){assert.notEqual(active.site.revision,old);assert.equal(active.css,'h1{color:maroon}');}
  else assert.equal(active.site.revision,old);
  active=await store.save(id,{...active,expectedRevision:active.site.revision,css:written?'aside{color:navy}':'aside{color:teal}'});
  assert.deepEqual((await store.scope(()=>store.names(directory+'/revisions',{directories:false}))).items,[active.site.revision+'.json']);
  assert.equal(await store.scope(()=>store.control(directory+'/versions/staging.json',{missing:true})),null);
 }
});
test('the retired byte limit accounts for unique history ownership, live owners and expired files',()=>{
 const resources=[{blob:'site/versions/files/document',size:2},{blob:'recording',size:9},{blob:'figure',size:6},{blob:'lost',size:1},{blob:'active',size:100}];
 const {kept,bytes}=retainedVersionFiles([{refs:[1,2,4]},{label:'Named',refs:[0,2,3,4]}],resources,new Set(resources.filter(f=>f.blob!=='lost').map(f=>f.blob)),new Set(['active']),10);
 assert.deepEqual([...kept].sort(),[0,2,4]);assert.equal(bytes,8);
});
test('named and recent limits release unreachable media without removing the separate recovery owner',async t=>{
 const {id,open}=await fixture(t),store=open(),name='pictures/'+randomUUID()+'.png',image=Buffer.from('Shared image');
 let active=await store.create({id,name:'Ageing study'});
 const ordinary=active.html,originalCSS=active.css,withImage=ordinary.replace('</main>','<img src="'+name+'" alt="Coastal station"></main>');
 const upload=async function*(){yield {name,bytes:image};};
 const receipt=await saveWebsiteRecovery(store,id,{id:randomUUID(),operationId:randomUUID(),path:active.path,baseRevision:active.site.revision,html:withImage,css:active.css,receivePictures:upload});
 active=await store.save(id,{...active,html:withImage,expectedRevision:active.site.revision,receivePictures:upload});
 const live=await store.scope(async()=>(await store.raw(id)).files.find(f=>f.name===name));
 active=await websiteVersions(store,id,'name',{expectedRevision:active.site.revision,label:'Keep photograph'});
 const protectedId=(await websiteVersions(store,id,'list',{expectedRevision:active.site.revision})).items[0].id;
 for(let i=0;i<maxVersions+1;i++)active=await store.save(id,{...active,expectedRevision:active.site.revision,html:ordinary,css:'p{padding:'+i+'px}'});
 const list=()=>websiteVersions(store,id,'list',{expectedRevision:active.site.revision});
 assert.equal((await list()).items.length,maxVersions);await stat(store.absolute(live.blob));
 active=await websiteVersions(store,id,'release',{expectedRevision:active.site.revision,version:protectedId});
 for(let i=0;i<maxNamed;i++)active=await websiteVersions(store,id,'name',{expectedRevision:active.site.revision,label:'Approval '+i});
 await assert.rejects(websiteVersions(store,id,'name',{expectedRevision:active.site.revision,label:'Overflow'}),{code:'LIMIT'});
 assert.equal((await list()).items.filter(e=>e.label).length,maxNamed);
 assert.ok(!(await list()).items.some(e=>e.id===protectedId));await assert.rejects(stat(store.absolute(live.blob)),{code:'ENOENT'});
 const current=await store.save(id,{...active,expectedRevision:active.site.revision,html:ordinary,css:originalCSS}),recovered=await websiteRecoveryResource(store,id,{id:receipt.id,path:receipt.documentKey,revision:receipt.revision,name,assetStamp:current.assetStamp});
 assert.deepEqual(await contentBuffer(recovered.content),image);
});
test('a private version cannot replace an included page and restoring an included version preserves later privacy',async t=>{
 const {id,open}=await fixture(t),store=open();
 const home=await store.create({id,name:'Access'}),path='working.html';
 let p=await store.createPage(id,{expectedRevision:home.site.revision,path,title:'Working'});
 p=await store.save(id,{...p,expectedRevision:p.site.revision,html:p.html.replace('</main>','<p>Author private draft wording</p></main>')});
 const name=async label=>{
  p=await websiteVersions(store,id,'name',{expectedRevision:p.site.revision,path,label});
  const items=await websiteVersions(store,id,'list',{expectedRevision:p.site.revision});
  return items.items[0].id;
 };
 const set=async inclusion=>{
  const opts={expectedRevision:p.site.revision,path,inclusion},r=await pageInclusion(store,id,opts);
  p=await pageInclusion(store,id,{...opts,reviewId:r.reviewId},true);
 };
 const hidden=await name('Private review');await set('included');
 p=await store.save(id,{...p,expectedRevision:p.site.revision,html:p.html.replace('Author private draft wording','Approved wording')});
 const included=await name('Included review');
 const review=(version)=>restoreWebsitePageVersion(store,id,{expectedRevision:p.site.revision,path,version});
 assert.equal((await review(hidden)).status,'private');
 await set('private');p=await store.save(id,{...p,expectedRevision:p.site.revision,html:p.html.replace('Approved wording','Current private wording')});
 const allowed=await review(included);assert.equal(allowed.status,'ready');assert.equal(allowed.draft,true);
 p=await restoreWebsitePageVersion(store,id,{expectedRevision:p.site.revision,path,version:included,reviewId:allowed.reviewId},true);
 assert.match(p.html,/Approved wording/);assert.ok(p.site.pages.find(s=>s.path===path).draft);
 assert.ok(!(await store.export(id)).files.has(path));
});
test('reviewing and restoring shared component and theme versions updates all current recipients atomically',async t=>{
 const {id,open}=await fixture(t),store=open();
 const html='<html><head><title>Atlas</title></head><body><main><section><h2>Original legend</h2></section></main></body></html>';
 let page=await store.importFiles(id,{name:'Atlas',files:new Map([['index.html',html],['methods.html',html],['style.css','']])});
 const act=(operation,options)=>componentOperation(store,operation,id,{expectedRevision:page.site.revision,...options});
 page=await act('create',{blockPath:'0/0',name:'Legend'});const component=(await act('list',{})).items[0].id;
 page=await act('insert',{path:'methods.html',position:'end',component});
 page=await websiteThemes(store,id,{expectedRevision:page.site.revision,path:'methods.html',action:'create',name:'Atlantic',values:{text:'#17364b'},scope:'page'},true);
 const theme=page.themeId;
 page=await websiteVersions(store,id,'name',{expectedRevision:page.site.revision,label:'Atlas design'});
 const version=(await websiteVersions(store,id,'list',{expectedRevision:page.site.revision})).items[0].id;
 page=await websiteThemes(store,id,{expectedRevision:page.site.revision,path:'methods.html',action:'design',themeId:theme,name:'Pacific',values:{text:'#133e20'}},true);
 page=await act('update',{component,name:'Legend',html:'<section><h2>Later legend</h2></section>'});
 for(const kind of ['component','themeBook']){
  const params={version,expectedRevision:page.site.revision,kind,component},review=await websiteVersionDesign(store,id,params);
  assert.equal(review.status,'ready');
  if(kind==='component')assert.deepEqual(review.items.filter(r=>r.reason==='instance').map(r=>r.name).sort(),['index.html','methods.html']);
  page=await websiteVersionDesign(store,id,{...params,reviewId:review.reviewId},true);
 }
 const result=await store.export(id);
 for(const name of ['index.html','methods.html'])assert.doesNotMatch((await contentBuffer(result.files.get(name))).toString(),/Later legend/);
 assert.match((await contentBuffer(result.files.get('website-themes/'+theme+'.css'))).toString(),/#17364b/);
});
