import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {FEATURE_MODULES} from '../src/web/feature-modules.js';
import {moduleLabel,moduleDescription,moduleProjectSettings} from '../src/web/module-presentation.js';
import {createDataRegistry,createDataSession,providerFields,displayValue} from '../src/web/data-registry.js';
import {registerResearchData} from '../src/web/research-data.js';
import {registerInventoryDashboard,inventoryComparisonFigure} from '../src/web/modules/inventory-dashboard.js';
import {cardInspector} from '../src/web/dashboard-inspector.js';
import {dashboardScope,dashboardScopeSettings,dashboardScopeLabel} from '../src/web/dashboard-scope.js';
import {createPanel,panelSpan} from '../src/web/dashboard-model.js';
import {sampleNotebook} from '../src/sample.js';

const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function choose(locale){await prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(locale);}
const text=(key,values)=>t('dashboardEditors',key,values);

test('module display follows language while canonical manifests and custom labels remain intact',async()=>{
 const original=FEATURE_MODULES.map(m=>({id:m.id,label:Object.getOwnPropertyDescriptor(m,'label')?.value,description:Object.getOwnPropertyDescriptor(m,'description')?.value}));
 try{for(const locale of locales){
  await choose(locale);
  assert.equal(moduleLabel('scientific-calculator'),t('calculator','label'));
  assert.equal(moduleLabel('laboratory-research-development'),t('labBookTypes','research-development.label'));
  assert.equal(moduleLabel('pdf-editor'),text('modulePdf'));
  assert.equal(moduleDescription({id:'resources'}),text('moduleInventoryDescription'));
  assert.equal(moduleProjectSettings(FEATURE_MODULES.find(m=>m.id==='resources')).action,text('chooseInventoryLocations'));
  assert.equal(moduleLabel({id:'custom-lab',label:'My <custom> lab'}),'My <custom> lab');
  assert.equal(moduleLabel('unknown-future-module'),'unknown-future-module');
  assert.deepEqual(FEATURE_MODULES.map(m=>({id:m.id,label:Object.getOwnPropertyDescriptor(m,'label')?.value,description:Object.getOwnPropertyDescriptor(m,'description')?.value})),original);
 }}finally{activateLanguage('en');}
});

test('registered provider display changes without replacing its identity, query, items or selected record',async()=>{
 const registry=createDataRegistry(),book=sampleNotebook();
 const authored=book.entries[0];authored.title='User <title>';authored.template={label:'experiment'};
 let loads=0;registerResearchData({register:provider=>registry.register({...provider,load:async(...args)=>{loads++;return provider.load(...args);}})});registerInventoryDashboard(registry);
 const records=registry.get('records'),inventory=registry.get('resources'),originalBook=JSON.stringify(book);
 const load=records.load,loadKey=records.loadKey,items=records.items;
 let requests=0;
 const context={book,recordLimit:7,recordKey:authored.id},session=createDataSession(registry,{context:()=>context,api:async()=>{requests++;throw Error('Unexpected request');},onChange:()=>{}});
 session.read('records');await setImmediate();
 const first=session.read('records'),selected=first.items.find(i=>i.key===authored.id);
 assert.equal(first.status,'ready');assert.ok(selected);
 const initialKeys=first.items.map(item=>item.key),initialData=JSON.stringify(selected.data);
 try{for(const locale of locales){
  await choose(locale);
  assert.equal(registry.get('records'),records);assert.equal(registry.all().find(p=>p.id==='records'),records);
  assert.equal(records.load,load);assert.equal(records.loadKey,loadKey);assert.equal(records.items,items);
  assert.equal(records.label,text('recentRecords'));assert.equal(records.group,text('labBooks'));
  assert.equal(inventory.label,text('inventory'));assert.equal(inventory.views[0].label,text('projectComparison'));
  const result=session.read('records'),item=result.items.find(i=>i.key===authored.id);
  assert.equal(result.status,'ready');assert.deepEqual(result.items.map(i=>i.key),initialKeys);
  assert.equal(item.title,'User <title>');assert.equal(JSON.stringify(item.data),initialData);
  const fields=providerFields(records,[item]);assert.equal(fields.find(f=>f.key==='type').label,text('recordType'));
  assert.equal(fields.find(f=>f.key==='type').format(item.data.type,{esc,item}),'experiment');
  assert.equal(fields.find(f=>f.key==='status').format('planned',{esc,item}),esc(t('recordValues','status_planned')));
  assert.equal(displayValue(true,esc),'<span class="desk-value">'+esc(text('yes'))+'</span>');
  assert.equal(requests,0);assert.equal(loads,1);assert.equal(JSON.stringify(book),originalBook);
 }}finally{session.close();activateLanguage('en');}
 const ordinary=createDataRegistry();ordinary.register({id:'plain',label:'Plain',items:()=>[]});
 assert.equal(ordinary.get('plain'),ordinary.all()[0]);assert.ok(Object.isFrozen(ordinary.get('plain')));
});

test('inspector and scope retain stored values, escape user titles and translate each rendering',async()=>{
 const book=sampleNotebook();book.title='A <workspace>';const projectId=book.projects[0].id;
 const selection={scopeMode:'selected',projectIds:[projectId],includeWorkspace:true,includeDescendants:false};
 const scope=[...dashboardScope(book,selection)],panel=createPanel('records','panel-1');panel.options=structuredClone(selection);panel.config.title='User <card>';panel.source={provider:'records',key:'pinned-1'};
 const original=JSON.stringify(panel);
 const button=(label,action,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`;
 const provider={label:'User <provider>',views:[{id:'custom',label:'Custom & view'}],settings:()=>dashboardScopeSettings({book},panel.options,panel)};
 try{for(const locale of locales){
  await choose(locale);
  const args={panel,provider,items:[],selected:[],title:panel.config.title,context:{book},fieldGroup:'details',esc,button,iconButton:(icon,label,action)=>button(esc(label),action),choiceUI:{view:()=>''}};
  const content=cardInspector({...args,tab:'content'}),layout=cardInspector({...args,tab:'layout'});
  assert.ok(content.includes(esc(text('pinnedItem'))));assert.ok(content.includes(esc(text('dataFrom'))));
  assert.ok(content.includes('User &lt;card&gt;'));assert.ok(content.includes('Custom &amp; view'));
  assert.ok(content.includes('value="'+projectId+'"'));assert.ok(!content.includes('User <card>'));
  assert.ok(layout.includes(esc(text('widthPercent',{percent:Math.round(panelSpan(panel.width)/12*100)}))));
  assert.ok(dashboardScopeLabel(book,selection).includes(text('workspaceScope',{title:book.title})));
  assert.deepEqual([...dashboardScope(book,selection)],scope);assert.equal(JSON.stringify(panel),original);
 }}finally{activateLanguage('en');}
});

test('inventory display translates metrics and choices without changing quantities, schema IDs or authored axis labels',async()=>{
 const registry=createDataRegistry();registerInventoryDashboard(registry);const provider=registry.get('resources');
 const item={key:'stock-1',title:'Authored <item>',data:{unit:'kg'},holdings:[{projectId:'p-1',label:'Authored location',physical:'3.125',reserved:'1.000',available:'2.125',used:'0',scrapped:'0'}]};
 const options={comparisonMetrics:['physical','available'],projectLabel:'My axis',quantityLabel:'My units'},original=JSON.stringify({item,options});
 try{for(const locale of locales){
  await choose(locale);
  const figure=inventoryComparisonFigure(item,options),table=provider.views.find(v=>v.id==='holdings').render({item,esc,options});
  assert.deepEqual(figure.series.map(s=>s.id),['physical','available']);assert.equal(figure.series[0].name,text('onHand'));
  assert.equal(figure.series[0].points[0].y,3.125);assert.equal(figure.x.label,'My axis');assert.equal(figure.y.label,'My units');
  assert.ok(table.includes('3.125'));assert.ok(table.includes('Authored &lt;item&gt;'));
  assert.ok(table.includes(esc(text('holdingsRegion',{title:item.title}))));assert.ok(table.includes(esc(text('projectStock'))));
  assert.equal(JSON.stringify({item,options}),original);
 }}finally{activateLanguage('en');}
});
