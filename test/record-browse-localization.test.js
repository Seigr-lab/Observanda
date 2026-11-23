import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {recordBrowseFields,recordDomainChoices} from '../src/web/record-query-ui.js';
import {recordActivityUI} from '../src/web/record-activity-ui.js';
import {labBookProfileLabel} from '../src/web/project-type-presentation.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,control)=>'<label>'+label+'</label>'+control;
const option=(value,label,current)=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>';
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});

test('record filters translate labels while retaining query values and custom domains',async context=>{
 context.after(()=>activateLanguage('en'));
 const state={recordBrowse:{tags:'My <tag>',tagMode:'any',from:'2026-01-01',to:'2026-12-31',status:'draft',domain:'custom-id',sort:'date-asc',dateKnowledge:'estimated'}};
 const original=structuredClone(state);
 for(const locale of ['en','ca','es','nb','nn']){
  await load(locale);activateLanguage(locale);
  const html=recordBrowseFields(state,[],{esc,field,option,domains:['beekeeping','custom-id']});
  assert.ok(html.includes(esc(t('applicationTexts','browseHelp'))));
  assert.ok(html.includes(esc(t('recordValues','status_draft'))));
  assert.ok(html.includes('value="date-asc" selected'));assert.ok(html.includes('value="estimated" selected'));
  assert.ok(html.includes('value="2026-01-01"'));assert.ok(html.includes('data-record-browse="tags"')&&html.includes('>My &lt;tag&gt;</textarea>'));
  assert.ok(html.includes(esc(labBookProfileLabel('beekeeping'))));
  assert.equal(recordDomainChoices(['custom-id']).at(-1).label,'custom-id');
  assert.deepEqual(state,original);
 }
});

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
test('linked history translates built-in names and tracking actions without rewriting authored data',async context=>{
 const previous=globalThis.document;globalThis.document=chooserDocument();
 context.after(()=>{globalThis.document=previous;activateLanguage('en');});
 const hive={id:'hive-template',profileId:'beekeeping',key:'hive',label:'My <hive>',enabled:true,fields:[]};
 const inspection={id:'inspection-template',profileId:'beekeeping',key:'inspection',label:'My inspection',enabled:true,fields:[]};
 const notebook={id:'notebook',projectId:'project',configuration:{profiles:[{id:'beekeeping',enabled:true}],sections:[hive,inspection]}};
 const record={id:'record',notebookId:'notebook',type:'note',template:{id:hive.id,profileId:'beekeeping',label:'My <hive>'},title:'My <record>'};
 const state={page:'record-reader',selected:'record',book:{id:'workspace',notebooks:[notebook],entries:[record]},storage:{},dashboardSettings:{enabledModules:['laboratory-beekeeping']}};
 const records=[{id:'linked',type:'observation',title:'My <observation>',status:'draft',occurredOn:'2026-10-29',linkedBy:[{type:'My <relationship>',revision:'old-revision-value'}]}];
 const original=structuredClone({state,records});let dialog='';const calls=[];
 const ui=recordActivityUI({state,esc,field,showDialog:value=>{dialog=value;},api:async(path,data)=>{calls.push({path,data});if(path.startsWith(configurationRoute))return configurationReply(notebook.configuration.sections,path.slice(configurationRoute.length),data);return {workspaceId:'workspace',records,total:1,offset:0,nextCursor:null,previousCursor:null};},notify:()=>{},revisions:()=>({record:'new-revision-value'}),create:()=>{}});
 // The record's type and the profile's next action come from the lab book's configuration.
 ui.view();ui.bind();for(let turn=0;turn<20;turn++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(calls.some(call=>call.path===configurationRoute+'section'));
 for(const locale of ['en','ca','es','nb','nn']){
  await load(locale);activateLanguage(locale);
  const before=ui.view();assert.ok(before.includes(esc(t('labBookProfiles','beekeeping.tracking.history.hive'))));
  assert.ok(before.includes(esc(t('labBookProfiles','beekeeping.tracking.primary'))));
  await ui.action({dataset:{action:'record-activity-show'}});
  const html=ui.view();assert.ok(html.includes(esc(t('applicationTexts','activityRange',{first:1,last:1,count:1}))));
  assert.ok(html.includes(esc(t('recordEditors','type_observation_label'))));assert.ok(html.includes(esc(t('recordValues','status_draft'))));
  assert.ok(html.includes('My &lt;relationship&gt;'));assert.ok(html.includes('My &lt;observation&gt;'));
  assert.ok(html.includes(esc(t('applicationTexts','activityRetainedDifferent',{revision:'old-revisi'}))));
  await ui.action({dataset:{action:'record-activity-create'}});
  assert.ok(dialog.includes('My &lt;hive&gt;'));assert.ok(dialog.includes(esc(t('recordEditors','type_observation_label'))));
  assert.deepEqual(calls.filter(call=>call.path==='/api/research/records/query').at(-1).data.relatedTo,{workspaceId:'workspace',id:'record'});
  assert.deepEqual({state,records},original);
 }
 ui.stop();
});
