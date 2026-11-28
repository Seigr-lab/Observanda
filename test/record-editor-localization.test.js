import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {RECORD_TYPES,recordLabel} from '../src/web/record-types.js';
import {recordTypeLabel,recordTypeDescription,recordTypePresentation} from '../src/web/record-type-presentation.js';
import {recordDetailsUI} from '../src/web/record-details-ui.js';
import {attemptForm} from '../src/web/attempt-form.js';

const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const source=structuredClone(RECORD_TYPES);
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const workspaceId='00000000-0000-4000-8000-000000000001',recordId='00000000-0000-4000-8000-000000000002',otherId='00000000-0000-4000-8000-000000000003';
const uiFor=entry=>recordDetailsUI({state:{book:{id:workspaceId,entries:[entry],projects:[],notebooks:[]},selected:recordId},esc,field:(label,control)=>'<label>'+label+control+'</label>'});

test('built-in type presentation follows language without altering shared or custom definitions',async context=>{
 context.after(()=>activateLanguage('en'));
 const custom={id:'custom',label:'Authored <type>',description:'My description',sections:['My section']};
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  for(const type of RECORD_TYPES){
   assert.equal(recordTypeLabel(type.id),t('recordEditors','type_'+type.id+'_label'));
   assert.equal(recordTypeDescription(type.id),t('recordEditors','type_'+type.id+'_description'));
   const shown=recordTypePresentation(type);
   assert.equal(shown.sections,type.sections);assert.equal(shown.id,type.id);
   assert.equal(recordLabel(type.id),source.find(item=>item.id===type.id).label);
  }
  assert.deepEqual(recordTypePresentation(custom),custom);
  assert.deepEqual(RECORD_TYPES,source);
 }
});

// Contributors and links are edited in the record page's value dialogs; the links list is read here.
test('record links translate while escaping authored values once',async context=>{
 context.after(()=>activateLanguage('en'));
 const authored='<img src=x onerror="fail()"> & 105₆';
 const entry={id:recordId,type:'note',contributors:[],relations:[{id:otherId,type:authored,label:authored,target:{workspaceId:otherId,kind:'record',id:recordId,revision:'a'.repeat(64)}}]};
 const before=structuredClone(entry),ui=uiFor(entry);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  const links=ui.relations(entry);
  assert.ok(links.includes(esc(t('recordLinks','revision',{revision:'a'.repeat(10)}))));
  assert.ok(links.includes(esc(t('recordLinks','anotherWorkspace'))));
  assert.ok(links.includes(esc(authored)));assert.ok(!links.includes('&amp;lt;'));assert.ok(!links.includes('<img'));
  assert.deepEqual(entry,before);
 }
});

test('attempt preparation choices use a translated parameterized label and preserve draft data',async context=>{
 context.after(()=>activateLanguage('en'));
 const description='<b>Keep authored applicability</b> & 105₆';
 const attempt={preparations:[{id:otherId,applicability:description}]};
 const draft={preparationId:otherId,kind:'prepared',label:'',extent:'complete',context:'unspecified',circumstances:'',actor:'',source:'',time:{meaning:'unknown',value:''},reason:'',references:[],supersedes:null};
 const before=structuredClone({draft,attempt});
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  const html=attemptForm({kind:'event',draft,attempt,esc,message:(key,args)=>t('attempts',key,args)});
  assert.ok(html.includes(esc(t('attempts','preparationChoice',{number:1,description}))));
  assert.ok(html.includes('value="'+otherId+'" selected'));
  assert.ok(!html.includes('<b>Keep authored'));assert.deepEqual({draft,attempt},before);
 }
});
