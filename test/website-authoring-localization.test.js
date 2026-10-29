import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {websiteLibraryUI} from '../src/web/website-library-ui.js';
import {PAGE_STARTERS} from '../src/web/website-layouts.js';
const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const field=(label,control)=>'<label>'+esc(label)+control+'</label>';
const option=(value,label,current)=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>';
function library(overrides={}){
 const state={book:{id:'workspace',pages:[],website:{home:{sections:[]},templates:[{id:'custom',name:'Authored <layout> & 105₆',sections:[]}],layouts:[],presentation:{media:[],covers:[]}}}};
 const ui=websiteLibraryUI({state,esc,field,option,sections:()=>state.book.website.home.sections,setSections:sections=>{state.book.website.home.sections=sections;},scopeTarget:()=>'home',changeLayout(){},checkpoint(){},changed(){},notify(){},render(){},...overrides});
 return {state,ui};
}
test('layout library translates starter presentation while preserving saved names and canonical starter data',async context=>{
 context.after(()=>activateLanguage('en'));const before=structuredClone(PAGE_STARTERS),{state,ui}=library(),saved=structuredClone(state.book.website.templates);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);const html=ui.view();
  assert.ok(html.includes(esc(t('websiteAuthoring','layouts'))));
  for(const starter of PAGE_STARTERS)assert.ok(html.includes(esc(t('websiteAuthoring','starter_'+starter.id+'_name'))));
  assert.ok(html.includes(esc(saved[0].name)));assert.ok(!html.includes('<layout>'));
  assert.ok(html.includes('value="append" selected'));assert.deepEqual(PAGE_STARTERS,before);assert.deepEqual(state.book.website.templates,saved);
 }
});
test('applying a translated layout retains the original authored starter content',async context=>{
 const previous=globalThis.document;context.after(()=>{globalThis.document=previous;activateLanguage('en');});
 globalThis.document={querySelector:()=>({value:'replace'})};
 for(const locale of locales){
  await load(locale);activateLanguage(locale);const {state,ui}=library();
  await ui.action({dataset:{action:'website-layout-apply'}});
  const copied=state.book.website.home.sections,source=PAGE_STARTERS.find(item=>item.id==='field-journal').sections;
  assert.deepEqual(copied.map(item=>({kind:item.kind,title:item.title,body:item.body})),source.map(item=>({kind:item.kind,title:item.title,body:item.body})));
  assert.ok(copied.every(item=>!source.some(original=>original.id===item.id)));
 }
});
test('malformed layout imports show a localized error and leave existing layouts unchanged',async context=>{
 context.after(()=>activateLanguage('en'));
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let resolve;const message=new Promise(done=>{resolve=done;});
  const {state,ui}=library({notify:resolve}),before=structuredClone(state.book);
  ui.input({id:'website-layout-import',hasAttribute:()=>false,files:[{size:4,text:async()=>'{bad'}]});
  assert.equal(await message,t('websiteAuthoring','layoutUnsupported'));assert.deepEqual(state.book,before);
 }
});
