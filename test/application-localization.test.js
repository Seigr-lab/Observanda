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

// A lab book's record types are read through its configuration, in the shape the server returns.
const configurationRoute='/api/research/configurations/';
const configurationReply=(sections,operation,data)=>{
 if(operation==='open')return {configurationPin:null,header:{counts:{profiles:1,sections:sections.length,fields:0,choices:0}},draft:null};
 if(operation==='window')return {configurationPin:null,draft:null,rows:sections.map((value,position)=>({key:value.id,position,value})),total:sections.length,offset:0,next:null};
 if(operation==='section'){const value=sections.find(s=>data.sectionId?s.id===data.sectionId:s.profileId===data.profileId&&s.key===data.key);return {configurationPin:null,draft:null,item:value?{key:value.id,value}:null};}
 if(operation==='profiles')return {configurationPin:null,draft:null,profiles:data.ids.map(id=>({id,enabled:true}))};
 throw Error('Unexpected configuration request '+operation);
};
// The type chooser draws into the open dialog it finds by its own marker.
const chooserDocument=()=>{const chooser={querySelector:()=>null,contains:()=>true};return {querySelector:selector=>selector==='#dialog'?{close(){}}:selector.startsWith('#dialog[open] [data-configuration-type-choices=')?chooser:null,activeElement:{}};};
test('record creation and editing localize built-in types while retaining authored templates',async context=>{
 const previousDocument=globalThis.document;globalThis.document=chooserDocument();
 context.after(()=>{globalThis.document=previousDocument;activateLanguage('en');});
 const notebook={id:'book',projectId:'project',title:'User notebook',configuration:{profiles:[],sections:[{id:'custom',profileId:null,key:'custom',label:'My <type>',description:'My <description>',enabled:true,fields:[]}]}};
 const state={notebook:'book',project:'project',book:{id:'workspace',notebooks:[notebook],projects:[{id:'project',title:'User project'}]},dashboardSettings:{},storage:{}};
 const before=structuredClone({state,types:RECORD_TYPES});
 let html='';
 const api=async(path,data)=>path.startsWith(configurationRoute)?configurationReply(notebook.configuration.sections,path.slice(configurationRoute.length),data):undefined;
 const ui=recordCreationUI({state,api,notebooks:{directory:()=>[notebook]},esc,showDialog:value=>{html=value;},locationName:()=>'',create:()=>{}});
 const record={type:'observation',status:'draft',occurredOn:'2026-10-29',title:'My <title>',outcome:'',share:false};
 const render=value=>recordEditingView({record:value,esc,status:'',busy:false,details:'',summary:'',sections:'',fields:{},activity:'',evidence:'',relations:''});
 const english=await catalogue('en');
 for(const locale of ['en','ca','es','nb','nn']){
  const messages=await catalogue(locale);assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());validateCatalogue(messages,english);
  await load(locale);activateLanguage(locale);await ui.choose('book');
  assert.ok(html.includes('data-type="observation"'));
  assert.ok(html.includes(esc(t('recordEditors','type_observation_label'))));
  assert.ok(html.includes(esc(t('recordEditors','type_observation_description'))));
  assert.ok(html.includes('My &lt;type&gt;'));assert.ok(!html.includes('My <type>'));
  const editing=render(record);assert.ok(editing.includes(esc(t('recordEditors','type_observation_label'))));
  const custom=render({...record,template:{label:'My <type>'}});assert.ok(custom.includes('My &lt;type&gt;'));
  assert.deepEqual({state,types:RECORD_TYPES},before);
 }
});
