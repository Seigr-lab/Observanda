import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {dashboardScope,dashboardBooks,dashboardBookSettings} from '../src/web/dashboard-scope.js';
import {defaultDashboard,createPanel,upgradeDashboard,validDashboard} from '../src/web/dashboard-model.js';
import {createDataRegistry} from '../src/web/data-registry.js';
import {registerResearchData} from '../src/web/research-data.js';
import {registerResources,registerPlanning} from '../src/web/modules/operations-data.js';
import {inventoryComparisonFigure} from '../src/web/modules/inventory-dashboard.js';
import {balance} from '../src/web/modules/quantities.js';
import {InventoryReader} from '../src/modules/inventory-reader.js';
import {moduleConstraint} from '../src/modules/constraints.js';
import {moduleView,moduleSearch} from '../src/modules/view.js';
import {moduleReferences} from '../src/modules/references.js';

// Keep the display fixtures small; PostgreSQL/current-head qualification lives
// in inventory-current.test.js. Exercise the same query and card adapters here.
async function inventoryRows(f,options={}){
 const service=new InventoryReader({root:'.'}),provider=f.registry.get('resources');
 service.reader.context=async(workspaceId,operation)=>operation({book:f.book,head:{workspaceId,revision:1,entities:f.entities},members:async function*(){yield* f.entities;},member:async id=>f.entities.find(e=>e.id===id),view:async e=>moduleView(e),constraint:async e=>moduleConstraint(e),search:async e=>moduleSearch(e),references:async e=>moduleReferences(e),selected:async id=>f.entities.find(e=>e.id===id),encode:v=>Buffer.from(JSON.stringify(v)).toString('base64url'),decode:v=>JSON.parse(Buffer.from(v,'base64url'))});
 service.reader.modules.validateEntity=()=>{};
 const c={book:f.book},result=await provider.load({context:c,options,api:(path,command)=>service.page(command)});
 return provider.items(c,result,options);
}

function fixture(){
 const book=sampleNotebook();book.title='Seigr';
 const base=book.projects[0],n=book.notebooks[0],record=book.entries[0];
 book.projects=['IT','Music','Field work','Bench'].map((title,i)=>({...base,id:randomUUID(),title,parentId:null,tools:['resources','planning']}));
 const [a,b,c,child]=book.projects;child.parentId=a.id;
 book.notebooks=book.projects.map(p=>({...n,id:randomUUID(),projectId:p.id}));
 book.notebooks.push({...n,id:randomUUID(),projectId:null});
 book.entries=book.notebooks.map((n,i)=>({...structuredClone(record),id:randomUUID(),notebookId:n.id,title:'Record '+i,contributors:[{id:randomUUID(),name:'Contributor '+i,role:'Author'}]}));
 const resource={id:randomUUID(),type:'resource',data:{name:'Op-amps',kind:'material',projectId:null,unit:'pieces',status:'available'}};
 const posters={id:randomUUID(),type:'resource',data:{...resource.data,name:'Posters'}};
 const entity=(type,data)=>({id:randomUUID(),type,data});
 const entities=[resource,posters,entity('movement',{resourceId:resource.id,projectId:null,delta:'1000'}),entity('movement',{resourceId:posters.id,projectId:null,delta:'1000'})];
 for(const [projectId,quantity] of [[a.id,'100'],[b.id,'200'],[child.id,'50']])entities.push(entity('stock-transfer',{resourceId:resource.id,fromProjectId:null,toProjectId:projectId,quantity}));
 entities.push(entity('reservation',{resourceId:resource.id,projectId:a.id,quantity:'20',status:'active'}));
 const registry=createDataRegistry();registerResearchData(registry);registerResources(registry);registerPlanning(registry);
 return {book,a,b,c,child,resource,posters,entities,registry,selected:{scopeMode:'selected',projectIds:[a.id,b.id],includeWorkspace:false,includeDescendants:true}};
}
test('dashboard selections combine arbitrary projects, descendants and workspace data without duplicates or empty-selection fallback',()=>{
 const {book,a,b,child,selected}=fixture();
 assert.deepEqual(dashboardScope(book,{...selected,projectIds:[a.id,child.id,b.id]}),new Set([a.id,child.id,b.id]));
 assert.deepEqual(dashboardScope(book,{...selected,projectIds:[]}),new Set());
 assert.deepEqual(dashboardScope(book,{...selected,projectIds:[],includeWorkspace:true}),new Set([null]));
 assert.equal(dashboardBooks(book,{...selected,projectIds:[],includeWorkspace:true}).length,1);
 assert.deepEqual(dashboardScope(book,{projectId:a.id}),new Set([a.id,child.id]));
 assert.deepEqual(dashboardScope(book,{}, {projectId:a.id}),new Set([a.id,child.id]));
 assert.equal(dashboardScope(book).size,5);
 assert.throws(()=>dashboardScope(book,{...selected,projectIds:[randomUUID()]}),/unavailable/);
 assert.doesNotThrow(()=>dashboardBookSettings({book},{...selected,projectIds:[randomUUID()]}));
});
test('research cards use the same union and lab-book subset; deleted selections fail closed',()=>{
 const s=fixture(),c={book:s.book},selected={...s.selected,includeDescendants:false};
 for(const id of ['records','contributors','projects','notebooks']){
  assert.equal(s.registry.get(id).items(c,null,selected).length,2,id);
  assert.equal(s.registry.get(id).items(c,null,{...selected,projectIds:[]}).length,0,id);
  assert.throws(()=>s.registry.get(id).items(c,null,{...selected,projectIds:[randomUUID()]}),/unavailable/);
 }
 const narrow={...selected,notebookMode:'selected',notebookIds:[s.book.notebooks[1].id]};
 assert.deepEqual(s.registry.get('records').items(c,null,narrow).map(i=>i.title),['Record 1']);
 narrow.notebookIds=[s.book.notebooks[2].id];assert.throws(()=>s.registry.get('records').items(c,null,narrow),/moved/);
});
test('research card loads reject missing or inconsistent navigation instead of stranding a visible page',async()=>{
 const f=fixture(),context={book:f.book,projectOwner:{projectId:f.book.projects[0].id,labBookId:f.book.notebooks[0].id},etag:'pinned',outline:true,recordLimit:2},options={};
 for(const id of ['records','contributors']){
  const rows=id==='records'?{records:f.book.entries.slice(0,2)}:{items:f.registry.get(id).items({...context,outline:false},null).slice(0,2)};
  const valid={workspaceId:f.book.id,etag:context.etag,...rows,total:5,offset:2,cursor:'current',previousCursor:'previous',nextCursor:'next'};
  const load=response=>f.registry.get(id).load({context,options,api:async()=>response});
  assert.deepEqual(await load(valid),valid);
  for(const change of [{previousCursor:undefined},{previousCursor:null},{previousCursor:''},{previousCursor:17},{previousCursor:'x'.repeat(4097)},{offset:0},{nextCursor:null},{nextCursor:[]},{cursor:''}])await assert.rejects(load({...valid,...change}),/card response was incomplete/);
  const start={...valid,offset:0,previousCursor:null};assert.deepEqual(await load(start),start);
  const end={...valid,offset:3,nextCursor:null};assert.deepEqual(await load(end),end);
 }
});
test('inventory comparisons use direct holdings, deduplicate overlapping scopes and never allocate or combine different items',async()=>{
 const s=fixture(),p=s.registry.get('resources'),before=JSON.stringify(s.entities),c={book:s.book};
 const rows=await inventoryRows(s,{...s.selected,projectIds:[s.a.id,s.child.id,s.b.id]});
 assert.equal(rows.length,1);assert.deepEqual([rows[0].data.physical,rows[0].data.reserved,rows[0].data.available],['350','20','330']);
 assert.deepEqual(rows[0].holdings.map(r=>r.physical),['100','50','200']);
 assert.equal(inventoryComparisonFigure(rows[0],{comparisonMetrics:['physical','reserved','available']}).series.length,3);
 assert.equal(inventoryComparisonFigure(rows[0]).series[0].points.length,3);
 const all=await inventoryRows(s);
 assert.equal(all.length,2);assert.equal(all[0].data.physical,'1000');assert.equal(all[1].data.physical,'1000');
 assert.equal(all[1].holdings.filter(r=>r.projectId!==null).every(r=>r.physical==='0'),true);
 const central=await inventoryRows(s,{...s.selected,projectIds:[],includeWorkspace:true});
 assert.equal(central[0].data.physical,'650');
 const zero=await inventoryRows(s,{...s.selected,projectIds:[s.c.id],resourceMode:'selected',resourceIds:[s.resource.id]});
 assert.equal(zero[0].holdings[0].physical,'0');
 assert.equal((await inventoryRows(s,{...s.selected,projectIds:[],resourceMode:'selected',resourceIds:[s.resource.id]})).length,0);
 assert.equal(JSON.stringify(s.entities),before);
 assert.equal(balance(s.entities,s.resource.id).physical,'1000');
 await assert.rejects(inventoryRows(s,{resourceMode:'selected',resourceIds:[randomUUID()]}),{code:'NOT_FOUND'});
});
test('inventory table keeps exact decimals, escapes names and updates from ledger; graph IDs belong to each card',async()=>{
 const s=fixture(),p=s.registry.get('resources'),options={...s.selected,resourceMode:'selected',resourceIds:[s.resource.id]};
 s.entities.push({id:randomUUID(),type:'movement',data:{resourceId:s.resource.id,projectId:s.a.id,delta:'0.000000000000000001'}});
 const item=(await inventoryRows(s,options))[0];
 assert.equal(item.data.physical,'350.000000000000000001');
 const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 item.title='<script>secret</script>';
 const view=p.views.find(v=>v.id==='comparison');
 const html=view.render({item,options,esc,panelId:'first'}),other=view.render({item,options,esc,panelId:'second'});
 assert.ok(html.includes('80.000000000000000001'));assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('inventory-first-plot-'));assert.ok(other.includes('inventory-second-plot-'));
});
test('planning providers send independent selected owners to paged queries and reject malformed navigation',async()=>{
 const s=fixture(),options={...s.selected,includeDescendants:false},context={book:s.book,recordLimit:5};
 for(const id of ['calendars','calendar-events']){
  const provider=s.registry.get(id),value={workspaceId:s.book.id,items:[{key:randomUUID(),title:'Selected item',data:{}}],total:1,offset:0,cursor:'page',nextCursor:null,previousCursor:null};
  const result=await provider.load({context,options,api:async(path,command)=>{assert.equal(path,'/api/modules/planning/dashboard');assert.deepEqual(command.scopeIds,[s.a.id,s.b.id]);assert.equal(command.limit,5);return value;}});
  assert.deepEqual(provider.items(context,result),value.items);
  await assert.rejects(provider.load({context,options,api:async()=>({...value,nextCursor:undefined})}),/could not be verified/);
 }
});
test('format 5 persists array selections while format 4 upgrades losslessly and rejects malformed selectors',()=>{
 const s=fixture(),value=defaultDashboard(),panel=createPanel('resources','inventory');
 value.views[0].panels=[panel];panel.options={...s.selected,resourceMode:'selected',resourceIds:[s.resource.id],comparisonMetrics:['physical','available']};
 assert.equal(validDashboard(value),true);assert.deepEqual(upgradeDashboard(value),value);
 for(const bad of [{projectIds:s.a.id},{projectIds:[s.a.id,s.a.id]},{projectIds:['missing']},{scopeMode:'nope'},{includeWorkspace:'yes'},{nested:[{}]}]){
  const invalid=structuredClone(value);Object.assign(invalid.views[0].panels[0].options,bad);assert.equal(validDashboard(invalid),false);
 }
 const old=defaultDashboard();old.formatVersion=4;old.views[0].panels[0].options={projectId:s.a.id};const before=JSON.stringify(old);
 assert.equal(upgradeDashboard(old).formatVersion,5);assert.deepEqual(upgradeDashboard(old).views,old.views);assert.equal(JSON.stringify(old),before);
});

test('duplicate project names do not merge plotted holdings and individual assets follow placement',async()=>{
 const s=fixture();s.b.title=s.a.title;
 const asset={id:randomUUID(),type:'resource',data:{name:'Synthesizer',kind:'object',projectId:null,placementId:s.b.id,status:'available',unit:''}};
 s.entities.push(asset);
 const items=await inventoryRows(s,s.selected);
 const stock=items.find(i=>i.key===s.resource.id),figure=inventoryComparisonFigure(stock);
 assert.equal(new Set(figure.series[0].points.map(p=>p.x)).size,3);
 const synth=items.find(i=>i.key===asset.id);
 assert.equal(synth.data.physical,'1');assert.deepEqual(synth.holdings.map(r=>r.physical),['0','0','1']);
 assert.equal(synth.data.owner,'Seigr');
});
