import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t,language} from '../src/web/i18n/index.js';
import {mediaImportsUI} from '../src/web/media-imports-ui.js';
import {reviewsUI} from '../src/web/reviews-ui.js';
import {organizationsUI} from '../src/web/organizations-ui.js';
const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const state=()=>({storage:{contextId:'context',encrypted:true},book:{id:'workspace',entries:[],notebooks:[]},selected:'record',page:'editor',dashboardSettings:{enabledModules:[]}});
function globals(context,values){
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,globalThis[key]]));Object.assign(globalThis,values);
 context.after(()=>{Object.assign(globalThis,previous);activateLanguage('en');});
}

test('media library translates canonical job states, stages and error codes without mutating jobs',async context=>{
 const pagerItems=new Map(),list={innerHTML:''},dialog={close(){}},pager={querySelector:selector=>{if(!pagerItems.has(selector))pagerItems.set(selector,{});return pagerItems.get(selector);}};
 globals(context,{document:{querySelector:()=>list,getElementById:id=>id==='media-import-list'?list:id==='media-import-pages'?pager:dialog,activeElement:null}});
 const stages=[['preparing','stage_preparing'],['Converting a display copy','stage_converting'],['Verifying the display copy','stage_verifying'],['Checking original file','stage_checking']];
 const items=stages.map(([stage],i)=>({id:'item'+i,name:'Original <authored> & 105₆',kind:'image',source:{},job:{state:'running',progress:{stage,done:0,total:1},cancelRequested:i===0}}));
 items.push({id:'failure',name:'failed',kind:'audio',source:{},job:{state:'failed',error:'MEDIA_INVALID',message:'English server fallback'}});
 const before=structuredClone(items),input={dataset:{upload:'attachment'}};
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let html='';
  const ui=mediaImportsUI({state:state(),api:async()=>({items,next:null}),esc,showDialog:value=>{html=value;},notify(){}});
  await ui.action({dataset:{action:'media-import-open'},parentElement:{querySelector:()=>input}});
  assert.ok(html.includes(esc(t('supportEditors','mediaPages'))));
  assert.equal(pagerItems.get('span').textContent,t('supportEditors','mediaPage',{number:1}));
  for(const [,key] of stages)assert.ok(list.innerHTML.includes(esc(t('supportEditors',key))));
  assert.ok(list.innerHTML.includes(esc(t('errors','MEDIA_INVALID'))));assert.ok(!list.innerHTML.includes('English server fallback'));
  assert.ok(list.innerHTML.includes(esc(items[0].name)));assert.ok(!list.innerHTML.includes('<authored>'));
  assert.deepEqual(items,before);await ui.action({dataset:{action:'media-import-close'}});
 }
});

test('media upload progress uses named localized byte counts while preserving upload requests',async context=>{
 const snapshots=[],status={hidden:false,remove(){},set innerHTML(value){snapshots.push(value);}},file={name:'Original.wav',size:2048,type:'audio/wav'},input={dataset:{upload:'attachment'},files:[file],parentElement:{after(){}}};
 const writes=[];
 class XHR{upload={};status=200;responseText='{}';open(method,url){writes.push({method,url});}setRequestHeader(){}send(value){assert.equal(value,file);this.upload.onprogress({loaded:1024});this.onload();}}
 globals(context,{XMLHttpRequest:XHR,document:{getElementById:()=>status,createElement:()=>status,querySelectorAll:()=>[input]}});
 for(const locale of locales){
  await load(locale);activateLanguage(locale);snapshots.length=0;const requests=[],applied=[];
  const ui=mediaImportsUI({state:state(),esc,busy(){},notify(){},apply:async(intent,asset)=>applied.push({intent,asset}),api:async(route,data)=>{requests.push({route,data});return route.endsWith('/start')?{id:'session'}:route.endsWith('/job')?{job:{state:'completed',result:{id:'asset'}}}:{};}});
  await ui.upload(input);
  assert.ok(snapshots.some(value=>value.includes(esc(t('supportEditors','mediaUploadProgress',{done:(1024).toLocaleString(language()),total:(2048).toLocaleString(language())})))));
  assert.deepEqual(requests[0].data,{name:file.name,size:2048,kind:'audio'});
  assert.equal(applied[0].intent.purpose,'attachment');assert.deepEqual(applied[0].asset,{id:'asset'});
 }
 assert.ok(writes.every(write=>write.method==='POST'&&write.url.endsWith('/api/media-imports/receive/session')));
});

test('review error codes and known validation details translate while unknown detail text stays exact and escaped',async context=>{
 globals(context,{location:{hash:'#/collaboration'}});
 const detail='A selected record changed. Preview the selection again.',custom='Original <detail> & 105₆';
 const failure={code:'INVALID',message:'English server fallback',details:[{field:detail},{field:custom}]},before=structuredClone(failure);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  const ui=reviewsUI({state:state(),api:async()=>{throw failure;},esc}),view=await ui.moduleUI(),html=view.view();
  assert.ok(html.includes(esc(t('errors','INVALID'))));
  assert.ok(html.includes(esc(t('supportEditors','reviewDetailRecordChanged'))));
  assert.ok(html.includes(esc(custom)));assert.ok(!html.includes('<detail>'));assert.deepEqual(failure,before);
 }
});

test('malformed review JSON reports a localized error before any import request',async context=>{
 const node={},file={size:4,text:async()=>'{bad',slice:()=>({text:async()=>'{bad'})};
 globals(context,{location:{hash:'#/collaboration'},document:{querySelector:()=>node},FormData:class{get(){return file;}}});
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let requests=0;
  const ui=reviewsUI({state:state(),api:async()=>{requests++;},esc});
  await ui.submit({id:'review-import-form',dataset:{}});
  assert.equal(node.textContent,t('supportEditors','reviewInvalidJSON'));assert.equal(requests,0);
 }
});

test('existing organization controls remain translated and preserve authored organization names',async context=>{
 context.after(()=>activateLanguage('en'));
 const snapshot={revision:'saved',organizations:[{id:'org',name:'Original <organization>',role:'member',members:[],teams:[],invitations:[]}],enrollments:[]},before=structuredClone(snapshot);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  const ui=await organizationsUI({state:state(),api:async()=>snapshot,esc}),html=ui.view();
  assert.ok(html.includes(esc(t('organizations','title'))));assert.ok(html.includes(esc(t('organizations','create'))));
  assert.ok(html.includes(esc(snapshot.organizations[0].name)));assert.ok(!html.includes('<organization>'));assert.deepEqual(snapshot,before);
 }
});
