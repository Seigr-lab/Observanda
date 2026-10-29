import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage} from '../src/web/i18n/index.js';
import {validateCatalogue} from '../src/web/i18n/runtime.js';
import {m,scopeControl,statusLabel} from '../src/web/modules/editor-presentation.js';
import {calendarForm,calendarTypes} from '../src/web/modules/calendar-fields.js';
import {bomForm,bomStock,newBOM} from '../src/web/modules/bom-ui.js';
import {bomLine} from '../src/web/modules/bom-model.js';
import {inventoryScopeControl} from '../src/web/modules/inventory-stock-ui.js';
import {createResourcesUI} from '../src/web/modules/resources-ui.js';
import {createToolUI} from '../src/web/tools/ui.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fetcher=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});
const catalogue=locale=>readFile(new URL('../src/web/locales/'+locale+'/moduleEditors.json',import.meta.url),'utf8').then(JSON.parse);
function context(current){
 const c={current,esc,scopeId:null,recursive:true,services:{state:{book:{id:'workspace',title:'<img src=x>',projects:[]},storage:{contextId:'session'}}},all:()=>[],get:()=>({data:current.data}),links:()=>'',disclosure:()=>'',recordField:()=>'',itemField:()=>'',ownerField:()=>''};
 c.field=(label,control)=>'<label>'+label+'</label>'+control;
 c.input=(key,label)=>c.field(esc(label),'<input value="'+esc(current.data[key]??'')+'">');
 c.option=(id,label)=>'<option value="'+esc(id)+'">'+esc(label)+'</option>';
 c.select=(key,label,choices)=>c.field(esc(label),'<select>'+choices.map(([id,title])=>c.option(id,title)).join('')+'</select>');
 c.check=(key,label)=>'<label>'+esc(label)+'</label>';
 c.button=label=>'<button>'+esc(label)+'</button>';
 return c;
}

test('module editor catalogues and rendered controls switch language without changing authored values',async t=>{
 const english=await catalogue('en');
 t.after(()=>activateLanguage('en'));
 for(const locale of ['en','ca','es','nb','nn']){
  const messages=await catalogue(locale);
  assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());
  validateCatalogue(messages,english);
  await prepareLanguage(locale,{fetcher});activateLanguage(locale);
  const event={type:'event',data:{title:'<img src=x>',calendarId:'',startsAt:'2026-10-29',endsAt:'2026-10-30',allDay:true,location:'User location',notes:'<script>alert(1)</script>',status:'confirmed'}};
  const before=structuredClone(event),c=context(event),html=calendarForm(event,c);
  assert.ok(html.includes(esc(messages.eventDetails)));
  assert.ok(html.includes('value="confirmed"'));
  assert.ok(html.includes('value="cancelled"'));
  assert.ok(html.includes(esc(messages.statusConfirmed)));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.deepEqual(event,before);
  assert.equal(calendarTypes[0].label,messages.calendars);
  assert.equal(statusLabel('confirmed'),messages.statusConfirmed);
  assert.equal(statusLabel('custom-user-status'),'custom-user-status');
  for(const scope of [scopeControl(c.services.state.book,null,esc),inventoryScopeControl(c)]){
   assert.ok(scope.includes('&lt;img src=x&gt;'));
   assert.ok(!scope.includes('<img'));
  }
  const bom={id:'bom',type:'bom',expectedRevision:1,data:{...newBOM(),title:'User BOM',recordTitle:'<img src=x>',recordRevision:'a'.repeat(64),lines:[{...bomLine(),value:'4k7',references:'R1',quantity:'2',unit:'items'}]}};
  const bomBefore=structuredClone(bom),bc=context(bom),form=bomForm(bom,bc);
  assert.ok(form.includes(esc(messages.billMaterials)));
  assert.ok(form.includes(esc(m('totalNeeded',{quantity:'2',unit:'items'}))));
  assert.ok(form.includes('value="4k7"'));
  assert.ok(!form.includes('<img'));
  bom.data.status='finished';bom.data.usage=[{lineId:bom.data.lines[0].id,used:'1',scrapped:'0'}];
  const stock=bomStock(bc);
  assert.ok(stock.includes(esc(messages.actualComponentUse)));
  assert.ok(stock.includes(esc(m('usageSummary',{name:'R1',used:'1',scrapped:'0',unused:'1',unit:'items'}))));
  bom.data.status=bomBefore.data.status;bom.data.usage=bomBefore.data.usage;
  assert.deepEqual(bom,bomBefore);
 }
});

test('existing inventory and tool editors refresh their metadata after a language change',async t=>{
 const previous=globalThis.document;
 globalThis.document={querySelector:()=>null,querySelectorAll:()=>[],activeElement:null};
 t.after(()=>{globalThis.document=previous;activateLanguage('en');});
 const state={page:'module',moduleId:'resources',modulePath:'scope/workspace/resource',book:{id:'workspace',title:'User workspace',projects:[],entries:[]},storage:{contextId:'session'}};
 const api=async path=>path.endsWith('/drafts/list')?{workspaceId:'workspace',drafts:[],nextCursor:null,previousCursor:null}:{workspaceId:'workspace',revision:0,items:[],offset:0,total:0,cursor:null,nextCursor:null,previousCursor:null};
 const c=context({data:{}}),services={...c,state,api,render:()=>{},notify:()=>{}};
 const resources=await createResourcesUI(services),tools=await createToolUI(services,'stoichiometry');
 t.after(()=>{resources.dispose();tools.dispose();});
 await prepareLanguage('es',{fetcher});activateLanguage('es');
 const messages=await catalogue('es');
 assert.ok(resources.view(state.modulePath).includes(esc(messages.inventory)));
 assert.ok(resources.view(state.modulePath).includes(esc(messages.boms)));
 state.moduleId='stoichiometry';state.modulePath='reaction';
 assert.ok(tools.view(state.modulePath).includes(esc(messages.stoichiometry)));
 assert.ok(tools.view(state.modulePath).includes(esc(messages.reactions)));
});
