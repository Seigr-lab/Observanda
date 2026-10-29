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
  assert.ok(html.includes('value="2026-01-01"'));assert.ok(html.includes('value="My &lt;tag&gt;"'));
  assert.ok(html.includes(esc(labBookProfileLabel('beekeeping'))));
  assert.equal(recordDomainChoices(['custom-id']).at(-1).label,'custom-id');
  assert.deepEqual(state,original);
 }
});

test('linked history translates built-in names and tracking actions without rewriting authored data',async context=>{
 const previous=globalThis.document;globalThis.document={querySelector:()=>null};
 context.after(()=>{globalThis.document=previous;activateLanguage('en');});
 const hive={id:'hive-template',profileId:'beekeeping',key:'hive',label:'My <hive>',enabled:true,fields:[]};
 const inspection={id:'inspection-template',profileId:'beekeeping',key:'inspection',label:'My inspection',enabled:true,fields:[]};
 const notebook={id:'notebook',projectId:'project',configuration:{profiles:[{id:'beekeeping',enabled:true}],sections:[hive,inspection]}};
 const record={id:'record',notebookId:'notebook',type:'note',template:{id:hive.id,profileId:'beekeeping',label:'My <hive>'},title:'My <record>'};
 const state={page:'record-reader',selected:'record',book:{id:'workspace',notebooks:[notebook],entries:[record]},storage:{},dashboardSettings:{enabledModules:['laboratory-beekeeping']}};
 const records=[{id:'linked',type:'observation',title:'My <observation>',status:'draft',occurredOn:'2026-10-29',linkedBy:[{type:'My <relationship>',revision:'old-revision-value'}]}];
 const original=structuredClone({state,records});let dialog='';const calls=[];
 const ui=recordActivityUI({state,esc,field,showDialog:value=>{dialog=value;},api:async(path,data)=>{calls.push({path,data});return {workspaceId:'workspace',records,total:1,offset:0,nextCursor:null,previousCursor:null};},notify:()=>{},render:()=>{},dirty:()=>{},revisions:()=>({record:'new-revision-value'}),create:()=>{}});
 for(const locale of ['en','ca','es','nb','nn']){
  await load(locale);activateLanguage(locale);
  const before=ui.view();assert.ok(before.includes(esc(t('applicationTexts','activityHiveHistory'))));
  assert.ok(before.includes(esc(t('applicationTexts','activityNewInspection'))));
  await ui.action({dataset:{action:'record-activity-show'}});
  const html=ui.view();assert.ok(html.includes(esc(t('applicationTexts','activityRange',{first:1,last:1,count:1}))));
  assert.ok(html.includes(esc(t('recordEditors','type_observation_label'))));assert.ok(html.includes(esc(t('recordValues','status_draft'))));
  assert.ok(html.includes('My &lt;relationship&gt;'));assert.ok(html.includes('My &lt;observation&gt;'));
  assert.ok(html.includes(esc(t('applicationTexts','activityRetainedDifferent',{revision:'old-revisi'}))));
  await ui.action({dataset:{action:'record-activity-create'}});
  assert.ok(dialog.includes('My &lt;hive&gt;'));assert.ok(dialog.includes(esc(t('recordEditors','type_observation_label'))));
  assert.deepEqual(calls.at(-1).data.relatedTo,{workspaceId:'workspace',id:'record'});
  assert.deepEqual({state,records},original);
 }
 ui.stop();
});
