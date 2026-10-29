import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {recordChanges,recordRevisionField,recordRevisionView,recordRevisionComparison} from '../src/web/record-revision-view.js';
import {recordTypeFilter} from '../src/web/record-type-filter.js';
import {recordValuesView} from '../src/web/record-values-ui.js';

const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const record=()=>({type:'run',status:'planned',outcome:'Authored <outcome> & 105₆',occurredOn:{kind:'unknown'},body:'',sections:[],figures:[],attachments:[],tags:[],contributors:[],relations:[],share:false});

test('revision headings and built-in labels follow language after module import while originals stay unchanged',async context=>{
 context.after(()=>activateLanguage('en'));
 const original=record(),current={...original,status:'completed'},before=structuredClone(original);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  assert.equal(recordChanges(original,current)[0].label,t('recordEditors','revision_status'));
  assert.equal(recordChanges({attempt:null},{attempt:{}})[0].label,t('attempts','title'));
  assert.equal(recordChanges({results:null},{results:[]})[0].label,t('analyses','results'));
  const html=recordRevisionView(original,esc);
  assert.ok(html.includes(esc(t('recordEditors','type_run_label'))));
  assert.ok(html.includes(esc(t('recordValues','status_planned'))));
  assert.ok(html.includes(esc(original.outcome)));assert.ok(!html.includes('<outcome>'));
  const comparison=recordRevisionComparison(original,current,esc);
  assert.ok(comparison.includes(esc(t('recordEditors','revisionEarlier'))));
  assert.ok(comparison.includes(esc(t('recordValues','status_completed'))));
  assert.equal(recordRevisionField('type',{...original,template:{label:'My <custom> type'}},esc),esc('My <custom> type'));
  assert.deepEqual(original,before);
 }
});

test('revision empty states, exact references and media accessibility labels are localized and escaped',async context=>{
 context.after(()=>activateLanguage('en'));
 const entry=record(),label='Original <link> & 105₆';
 entry.relations=[{type:'Authored relation',label,target:{revision:'a'.repeat(64)}}];
 entry.attachments=[{id:'audio',kind:'audio',caption:'',alt:'',transcript:''}];
 const before=structuredClone(entry);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  assert.equal(recordRevisionField('share',entry,esc),esc(t('recordEditors','revisionPrivate')));
  assert.ok(recordRevisionField('sections',entry,esc).includes(esc(t('recordEditors','revisionNoSections'))));
  const relations=recordRevisionField('relations',entry,esc);
  assert.ok(relations.includes(esc(t('recordEditors','revisionExactLink',{label,revision:'a'.repeat(12)}))));
  assert.ok(!relations.includes('<link>'));
  assert.ok(recordRevisionField('attachments',entry,esc).includes('aria-label="'+esc(t('recordEditors','media_audio'))+'"'));
  assert.deepEqual(entry,before);
 }
});

test('type filters translate builtin labels from both fallback definitions and server pages while preserving custom labels',async context=>{
 const previous=globalThis.document;context.after(()=>{globalThis.document=previous;activateLanguage('en');});
 globalThis.document={querySelector:()=>({addEventListener(){},close(){}}),getElementById:()=>null};
 const template='template:00000000-0000-4000-8000-000000000001',custom='Custom <authored> & type';
 const page={workspaceId:'workspace',etag:'revision',items:[{value:'run',label:'Run or take'},{value:template,label:custom}],total:2,offset:0,previousCursor:null,nextCursor:null,selected:{value:template,label:custom}};
 const before=structuredClone(page);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  const state={book:{id:'workspace'},filter:template,storage:{contextId:'context'}};
  const ui=recordTypeFilter({state,api:async()=>page,esc,snapshot:()=>'revision'});
  assert.ok(ui.view().includes(esc(t('recordEditors','type_run_label'))));
  ui.bind();await new Promise(resolve=>setImmediate(resolve));
  const html=ui.view();assert.ok(html.includes(esc(t('recordEditors','type_run_label'))));
  assert.ok(html.includes(esc(custom)));assert.ok(!html.includes('<authored>'));
  assert.deepEqual(page,before);ui.stop();
 }
});

test('record type value controls preserve keys and localize date validation without rewriting invalid input',async context=>{
 context.after(()=>activateLanguage('en'));
 const ui=recordValuesView({esc,field:(label,input)=>'<label>'+label+input+'</label>',state:{}},{context:()=>'',refresh(){}});
 const base={field:'type',value:{value:'run'}},draft={value:'run'},invalid={value:{kind:'range',from:'2026-10-29',to:'2026-10-01',estimated:false}},before=structuredClone(invalid),error={};
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  assert.ok(ui.fields(base,draft).includes('value="run" selected>'+esc(t('recordEditors','type_run_label'))));
  assert.equal(ui.preview(base),'<p>'+esc(t('recordEditors','type_run_label'))+'</p>');
  assert.equal(ui.validate({querySelector:()=>error},{field:'occurredOn'},invalid),false);
  assert.equal(error.textContent,t('recordEditors','dateOrder'));
  assert.deepEqual(invalid,before);assert.deepEqual(draft,{value:'run'});
 }
});
