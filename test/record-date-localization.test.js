import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';
import {recordDateFields,updateRecordDate} from '../src/web/record-date-ui.js';
import {recordDateIssue} from '../src/web/record-date.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const helpers={esc,field:(label,input)=>'<label>'+esc(label)+input+'</label>',option:(value,label,current)=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>'};
const nodes=node=>[node,...(node.childNodes??[]).flatMap(nodes)];
const attrs=(html,name)=>nodes(parseFragment(html)).flatMap(node=>(node.attrs??[]).filter(attr=>attr.name===name).map(attr=>attr.value));

test('record date controls and errors translate without inventing date precision or changing stored values',async context=>{
 context.after(()=>activateLanguage('en'));
 for(const language of ['en','ca','es','nb','nn']){
  await prepareLanguage(language,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(language);
  const range={kind:'range',from:'2024-03-01',to:'2024-02-29',estimated:true},before=structuredClone(range),html=recordDateFields(range,helpers);
  assert.ok(html.includes(esc(t('recordDates','fieldPrecision'))));assert.ok(html.includes(esc(t('recordDates','estimatedRange'))));assert.ok(html.includes(esc(t('recordEditors','dateOrder'))));
  assert.deepEqual(attrs(html,'value'),['day','month','year','range','unknown','2024-03-01','2024-02-29']);assert.deepEqual(range,before);
  assert.equal(recordDateIssue(range),'The start date must be on or before the end date.');
  const record={occurredOn:'2024-02-29'},values={},error={},group={querySelector:selector=>selector==='[data-record-date-values]'?values:error};
  updateRecordDate({dataset:{recordDate:'kind'},value:'year',closest:()=>group},record,helpers);
  assert.deepEqual(record.occurredOn,{kind:'year',value:'2024',estimated:false});assert.ok(values.innerHTML.includes(esc(t('recordDates','fieldYear'))));assert.equal(error.textContent,'');
  updateRecordDate({dataset:{recordDate:'kind'},value:'day',closest:()=>group},record,helpers);
  assert.equal(record.occurredOn,'');assert.equal(error.textContent,t('recordEditors','dateInvalidDay'));
 }
});
