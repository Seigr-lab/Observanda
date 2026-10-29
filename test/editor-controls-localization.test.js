import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';
import {textTools} from '../src/web/text-tools.js';
import {folderPickerUI} from '../src/web/folder-picker-ui.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';

const locales=['en','nb','nn','ca','es'];
const load=async locale=>{await prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(locale);};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const nodes=node=>[node,...(node.childNodes??[]).flatMap(nodes)];
const attr=(node,name)=>node.attrs?.find(attribute=>attribute.name===name)?.value;
const attributes=(html,name)=>nodes(parseFragment(html)).map(node=>attr(node,name)).filter(value=>value!==undefined);

test('formatting controls translate while retaining commands, document destinations and safe markup',async context=>{
 context.after(()=>activateLanguage('en'));
 const destinations=[{label:'Authored <b>name</b> & "title"',href:'observanda://example/record',context:'Custom context'}],original=structuredClone(destinations);
 let commands;
 for(const locale of locales){
  await load(locale);
  for(const compact of [true,false]){
   const html=textTools({destinations,compact,fonts:[]}),current=attributes(html,'data-rich-command').sort();
   commands??=current;assert.deepEqual(current,commands);
   assert.ok(attributes(html,'aria-label').includes(t('editorControls','formatting')));
   assert.ok(attributes(html,'aria-label').includes(t('editorControls','linkAddress')));
   assert.ok(attributes(html,'title').includes(t('editorControls','bold')));
   assert.deepEqual(attributes(html,'data-rich-destination'),[destinations[0].href]);
   assert.deepEqual(attributes(html,'data-rich-label'),[destinations[0].label]);
   assert.deepEqual(attributes(html,'name'),['label','href','target','title','nofollow']);
   assert.ok(!html.includes('<b>name</b>'));assert.ok(!html.includes('&amp;lt;'));
   assert.deepEqual(destinations,original);
  }
 }
});

test('folder controls translate and choose the original filesystem path without localizing directory names',async context=>{
 const originalDocument=globalThis.document;
 context.after(()=>{globalThis.document=originalDocument;activateLanguage('en');});
 for(const locale of locales){
  await load(locale);
  let html='',closed=false,inputs=0;
  const target={value:'/example/original',isConnected:true,focus(){},dispatchEvent(){inputs++;}},dialog={open:false,close(){closed=true;}};
  globalThis.document={activeElement:null,getElementById:()=>target,querySelector:selector=>selector==='#dialog'?dialog:null,querySelectorAll:()=>[]};
  const listing={folder:'/example/chosen',parent:'/example',breadcrumbs:[{path:'/example/chosen',name:'Authored <folder>'}],places:[{kind:'home',path:'/example',name:'Home'}],folders:[{path:'/example/child',name:'Authored <child>'}],total:1,offset:0,hasMore:false};
  const ui=folderPickerUI({api:async()=>listing,esc,field:(label,control)=>'<label>'+label+control+'</label>',showDialog:value=>{html=value;},capabilities:()=>({mode:'server'})});
  await ui.action({dataset:{action:'storage-browse',target:'folder'}});
  assert.ok(html.includes(esc(t('editorControls','serverFolder'))));
  assert.ok(html.includes(esc(t('editorControls','folderCount',{count:1}))));
  assert.ok(attributes(html,'aria-label').includes(t('editorControls','searchFolder')));
  assert.ok(attributes(html,'data-path').includes('/example/child'));
  assert.ok(html.includes('Authored &lt;child&gt;'));assert.equal(target.value,'/example/original');
  await ui.action({dataset:{action:'storage-browse-use'}});
  assert.equal(target.value,'/example/chosen');assert.equal(inputs,1);assert.equal(closed,true);
 }
});
