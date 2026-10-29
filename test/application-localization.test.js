import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {validateCatalogue} from '../src/web/i18n/runtime.js';
import {recordCreationUI} from '../src/web/record-creation-ui.js';
import {recordEditingView} from '../src/web/record-editing-view.js';
import {RECORD_TYPES} from '../src/web/record-types.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const catalogue=locale=>readFile(new URL('../src/web/locales/'+locale+'/applicationTexts.json',import.meta.url),'utf8').then(JSON.parse);

test('record creation and editing localize built-in types while retaining authored templates',async context=>{
 context.after(()=>activateLanguage('en'));
 const notebook={id:'book',projectId:'project',title:'User notebook',configuration:{profiles:[],sections:[{id:'custom',profileId:null,key:'custom',label:'My <type>',description:'My <description>',enabled:true,fields:[]}]}};
 const state={notebook:'book',project:'project',book:{id:'workspace',notebooks:[notebook],projects:[{id:'project',title:'User project'}]},dashboardSettings:{},storage:{}};
 const before=structuredClone({state,types:RECORD_TYPES});
 let html='';
 const ui=recordCreationUI({state,api:()=>{},notebooks:{directory:()=>[notebook]},esc,showDialog:value=>{html=value;},locationName:()=>'',create:()=>{}});
 const record={type:'observation',status:'draft',occurredOn:'2026-10-29',title:'My <title>',outcome:'',share:false};
 const render=value=>recordEditingView({record:value,esc,status:'',busy:false,details:'',summary:'',sections:'',fields:{},activity:'',evidence:'',relations:''});
 const english=await catalogue('en');
 for(const locale of ['en','ca','es','nb','nn']){
  const messages=await catalogue(locale);assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());validateCatalogue(messages,english);
  await load(locale);activateLanguage(locale);ui.choose('book');
  assert.ok(html.includes('data-type="observation"'));
  assert.ok(html.includes(esc(t('recordEditors','type_observation_label'))));
  assert.ok(html.includes(esc(t('recordEditors','type_observation_description'))));
  assert.ok(html.includes('My &lt;type&gt;'));assert.ok(!html.includes('My <type>'));
  const editing=render(record);assert.ok(editing.includes(esc(t('recordEditors','type_observation_label'))));
  const custom=render({...record,template:{label:'My <type>'}});assert.ok(custom.includes('My &lt;type&gt;'));
  assert.deepEqual({state,types:RECORD_TYPES},before);
 }
});
