import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationReviewChoicesUI} from '../src/web/publication-review-choices.js';

const origin='http://127.0.0.1:48500',prefix='/preview/retained-edition/';
const page=path=>({path,title:path});
const windowOf=(items,offset=0,total=80)=>({items,offset,total,next:null});
function fixture(t){
 const prior=Object.fromEntries(['document','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const mounts=Object.fromEntries(['publication-page-choices','publication-reference-choices','preview-page','full-public-preview'].map(key=>[key,{innerHTML:'unchanged',value:'index.html',href:prefix+'index.html'}]));
 Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>mounts[id]??null}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin}});
 t.after(()=>{for(const [key,value] of Object.entries(prior)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const preview={id:'retained-edition',websitePin:{researchSnapshotId:'a'.repeat(64),websiteId:null,websiteRevision:'b'.repeat(64)},currentPage:'index.html',url:prefix+'index.html',pages:[page('index.html')],pagesWindow:windowOf([page('index.html')]),referenceReviewsWindow:windowOf([])};
 const state={page:'review',preview},requests=[];
 const api=(route,command,options)=>new Promise((resolve,reject)=>requests.push({route,command,options,resolve,reject}));
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const ui=publicationReviewChoicesUI({state,api,esc,option:(value,title,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(title)}</option>`});
 const frame={isConnected:true,src:origin+preview.url,contentWindow:{location:new URL(origin+preview.url)}};
 return {state,preview,requests,mounts,ui,frame,navigate:path=>{frame.contentWindow.location=new URL(origin+prefix+path);}};
}

test('retained page and reference windows adopt independently with their captured website pin',async t=>{
 const f=fixture(t),pages=f.ui.load('pages',{offset:32}),references=f.ui.load('references',{offset:16});
 assert.deepEqual(f.requests.map(request=>[request.route,request.command.limit]),[['/api/publication-jobs/pages',32],['/api/publication-jobs/references',16]]);
 for(const request of f.requests){assert.equal(request.command.id,f.preview.id);assert.equal(request.options.adopt,false);assert.equal(request.options.websitePin,f.preview.websitePin);}
 const referenceWindow=windowOf([{title:'Retained result',count:2}],16),pageWindow=windowOf([page('pages/late.html')],32);
 f.requests[1].resolve(referenceWindow);await references;f.requests[0].resolve(pageWindow);await pages;
 assert.equal(f.preview.pagesWindow,pageWindow);assert.equal(f.preview.referenceReviewsWindow,referenceWindow);assert.equal(f.preview.currentPage,'index.html');
 assert.match(f.mounts['publication-page-choices'].innerHTML,/pages\/late.html/);assert.match(f.mounts['publication-reference-choices'].innerHTML,/Retained result/);
});

test('newer windows supersede only their own collection and obsolete failures cannot affect another edition',async t=>{
 const f=fixture(t),old=f.ui.load('pages',{offset:32}),latest=f.ui.load('pages',{offset:64}),expected=windowOf([page('pages/latest.html')],64);
 f.requests[1].resolve(expected);await latest;f.requests[0].resolve(windowOf([page('pages/old.html')],32));await old;assert.equal(f.preview.pagesWindow,expected);
 const obsolete=f.ui.load('references');f.state.preview={...f.preview,id:'another-edition'};f.requests[2].reject(Error('old request failed'));await obsolete;
 assert.equal(f.mounts['publication-reference-choices'].innerHTML,'unchanged');
 const current=f.ui.load('references');f.requests[3].reject(Error('current request failed'));await assert.rejects(current,/current request failed/);
 assert.equal(f.mounts['publication-reference-choices'].innerHTML,'unchanged');
});

test('a late iframe lookup cannot overwrite a newer already-loaded page or its controls',async t=>{
 const f=fixture(t);f.navigate('pages/late.html');const old=f.ui.follow(f.frame,prefix);
 assert.equal(f.requests[0].command.path,'pages/late.html');f.navigate('index.html');await f.ui.follow(f.frame,prefix);
 f.requests[0].resolve(windowOf([page('pages/late.html')],64));await old;
 assert.equal(f.preview.currentPage,'index.html');assert.equal(f.preview.url,prefix+'index.html');assert.deepEqual(f.preview.pages,[page('index.html')]);
 assert.equal(f.mounts['publication-page-choices'].innerHTML,'unchanged');assert.equal(f.mounts['preview-page'].value,'index.html');assert.equal(f.mounts['full-public-preview'].href,prefix+'index.html');
});

test('iframe lookups retain only the latest destination while reference pagination continues',async t=>{
 const f=fixture(t);f.navigate('pages/first.html');const first=f.ui.follow(f.frame,prefix);f.navigate('pages/latest.html');const latest=f.ui.follow(f.frame,prefix),references=f.ui.load('references',{offset:16});
 f.requests[0].resolve(windowOf([page('pages/first.html')],32));await first;assert.equal(f.preview.currentPage,'index.html');assert.equal(f.mounts['publication-page-choices'].innerHTML,'unchanged');
 f.requests[2].resolve(windowOf([{title:'Current reference',count:1}],16));await references;
 await f.ui.follow({...f.frame,isConnected:false},prefix);
 f.requests[1].resolve(windowOf([page('pages/latest.html')],64));await latest;
 assert.equal(f.preview.currentPage,'pages/latest.html');assert.equal(f.preview.url,prefix+'pages/latest.html');assert.deepEqual(f.preview.pages,[page('pages/latest.html')]);
 assert.equal(f.mounts['preview-page'].value,'pages/latest.html');assert.equal(f.mounts['full-public-preview'].href,prefix+'pages/latest.html');assert.match(f.mounts['publication-reference-choices'].innerHTML,/Current reference/);
});

test('in-flight iframe lookup preserves a newly selected navigation before the next frame load',async t=>{
 const f=fixture(t);f.navigate('pages/late.html');const pending=f.ui.follow(f.frame,prefix);
 f.preview.currentPage='pages/chosen.html';f.frame.src=origin+prefix+'pages/chosen.html';f.mounts['preview-page'].value='pages/chosen.html';f.mounts['full-public-preview'].href=prefix+'pages/chosen.html';
 // contentWindow still has the old location until the selected navigation loads.
 f.requests[0].resolve(windowOf([page('pages/late.html')],32));await pending;
 assert.equal(f.preview.currentPage,'pages/chosen.html');assert.deepEqual(f.preview.pages,[page('index.html')]);assert.equal(f.mounts['publication-page-choices'].innerHTML,'unchanged');
 assert.equal(f.mounts['preview-page'].value,'pages/chosen.html');assert.equal(f.mounts['full-public-preview'].href,prefix+'pages/chosen.html');
});

test('detached, inaccessible and departed iframe consumers discard their late responses',async t=>{
 for(const kind of ['detached','inaccessible','departed'])await t.test(kind,async t=>{
  const f=fixture(t);f.navigate('pages/late.html');const pending=f.ui.follow(f.frame,prefix);
  if(kind==='detached')f.frame.isConnected=false;
  else if(kind==='inaccessible')Object.defineProperty(f.frame.contentWindow,'location',{get(){throw Error('cross origin');}});
  else f.state.page='publishing';
  f.requests[0].resolve(windowOf([page('pages/late.html')],32));await pending;
  assert.equal(f.preview.currentPage,'index.html');assert.deepEqual(f.preview.pages,[page('index.html')]);assert.equal(f.mounts['publication-page-choices'].innerHTML,'unchanged');assert.equal(f.mounts['full-public-preview'].href,prefix+'index.html');
 });
});
