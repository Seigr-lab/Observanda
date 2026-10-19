import {randomUUID} from 'node:crypto';
import {queryPanel,matchesTool} from '../src/web/dashboard-queries.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {defaultDashboard,validDashboard,moveItem,createPanel,upgradeDashboard} from '../src/web/dashboard-model.js';
import {readPreferences,rememberLocation,rememberInterface,saveDashboard,dashboardSnapshot} from '../src/preferences.js';
import {DEFAULT_INTERFACE} from '../src/web/interface-ui.js';
import {startServer} from '../src/server.js';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {routeFor,resolveRoute} from '../src/web/navigation.js';

function legacyDashboard(version){
 const value=defaultDashboard();value.formatVersion=version;delete value.shortcuts;delete value.enabledModules;value.enabledTools=['records','projects','media','website'];
 for(const view of value.views)for(const p of view.panels){for(const key of ['moduleId','column','hidden','source','fields','presentation','options'])delete p[key];if(version<3)delete p.height;if(version<2)delete p.config;}
 return value;
}

const temp=async()=>mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-'));

test('dashboard schema rejects ambiguous layouts and preserves unknown tool identities for forward compatibility',()=>{
 assert.equal(validDashboard(defaultDashboard()),true);
 for(const mutate of [s=>s.formatVersion=99,s=>s.defaultId='missing',s=>s.views.push(s.views[0]),s=>s.views[0].panels.push(s.views[0].panels[0]),s=>s.views[0].panels[0].width='gigantic',s=>s.views[0].panels[0].count=1.5,s=>s.views[0].name=' ',s=>s.views[0].name='x'.repeat(81),s=>s.enabledModules.push(s.enabledModules[0]),s=>s.views[0].panels[0].tool='<script>',s=>s.extra=true]){
  const settings=defaultDashboard();mutate(settings);assert.equal(validDashboard(settings),false);
 }
 const future=defaultDashboard();future.enabledModules.push('future-module');future.views[0].panels.push(createPanel('future-tool','kept','full'));assert.equal(validDashboard(future),true);
 const values=['a','b','c'];assert.deepEqual(moveItem(values,0,2),['b','c','a']);assert.deepEqual(values,['a','b','c']);assert.deepEqual(moveItem(values,0,-1),values);
});

test('older preferences gain defaults in memory without modifying original bytes; dashboard saves preserve other settings',async()=>{
 const root=await temp(),file=path.join(root,'preferences.json');const raw=JSON.stringify({formatVersion:1,workspace:root,recent:[],interface:DEFAULT_INTERFACE},null,4);await writeFile(file,raw);
 const original=await readPreferences(file);assert.deepEqual(original.dashboard,defaultDashboard());assert.equal(await readFile(file,'utf8'),raw);
 const current=dashboardSnapshot(original.dashboard),edited=structuredClone(current.settings);edited.views[0].name='Sound research';
 await rememberInterface(file,{...DEFAULT_INTERFACE,fontSize:22});await rememberLocation(file,root,{title:'Research',label:'Studio'});
 await saveDashboard(file,edited,current.etag);const stored=await readPreferences(file);assert.equal(stored.interface.fontSize,22);assert.equal(stored.recent[0].title,'Research');assert.equal(stored.dashboard.views[0].name,'Sound research');
});

test('concurrent dashboard writers cannot overwrite one another and a rejected write keeps all preference bytes',async()=>{
 const root=await temp(),file=path.join(root,'preferences.json'),initial=dashboardSnapshot((await readPreferences(file)).dashboard);
 const a=structuredClone(initial.settings),b=structuredClone(initial.settings);a.views[0].name='First';b.views[0].name='Second';
 const results=await Promise.allSettled([saveDashboard(file,a,initial.etag),saveDashboard(file,b,initial.etag)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'DASHBOARD_CHANGED');
 const raw=await readFile(file,'utf8');await assert.rejects(saveDashboard(file,b,'stale'),{code:'DASHBOARD_CHANGED'});assert.equal(await readFile(file,'utf8'),raw);
 const wrong=structuredClone(a);wrong.views=[];await assert.rejects(saveDashboard(file,wrong,initial.etag),{code:'INVALID'});assert.equal(await readFile(file,'utf8'),raw);
});

test('dedicated preference routes retain old bookmarks and stable dashboard navigation',()=>{
 const book=sampleNotebook();for(const [page,tab] of [['preferences','general'],['dashboard-settings','dashboard'],['appearance','appearance'],['integrations','integrations'],['storage','storage']]){assert.equal(routeFor({page}),`#/preferences/${tab}`);assert.equal(resolveRoute(`#/preferences/${tab}`,book).page,page);}
 assert.equal(resolveRoute('#/appearance',book).page,'appearance');assert.equal(resolveRoute('#/storage',book).page,'storage');assert.equal(resolveRoute('#/preferences/unknown',book).page,'workspace');
});

test('default website routes remain distinct from application preferences and round-trip after reopening',()=>{
 const book=sampleNotebook();
 for(const [page,segment] of [['website','editor'],['integrations','settings'],['appearance','appearance'],['publishing','publishing']]){
  const hash='#/websites/default/'+segment,state=resolveRoute(hash,book);
  assert.equal(state.page,page);assert.equal(state.websiteId,null);assert.equal(state.websiteDefaultRoute,true);assert.equal(routeFor(state),hash);
 }
 for(const page of ['appearance','integrations']){const hash='#/preferences/'+page,state=resolveRoute(hash,book);assert.equal(state.websiteDefaultRoute,false);assert.equal(routeFor(state),hash);}
});

test('dashboard API enforces session, origin and conflict checks, survives restart and never edits the research manifest',async()=>{
 const root=await temp(),file=path.join(root,'preferences.json'),book=sampleNotebook();book.title=path.basename(root);await new Workspace(root).create(book);const original=await readFile(path.join(root,'observanda.json'),'utf8');let app=await startServer({root,preferencesFile:file,port:0});
 try{
  assert.equal((await fetch(app.origin+'/api/dashboard')).status,401);
  const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});const cookie=auth.headers.get('set-cookie').split(';')[0];
  const request=(route,data,origin=app.origin)=>fetch(app.origin+route,{...(data?{method:'POST',body:JSON.stringify(data)}:{}),headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'}});
  const initial=await (await request('/api/dashboard')).json();initial.settings.views[0].name='Private dashboard title';
  assert.equal((await request('/api/dashboard',initial,'https://untrusted.invalid')).status,403);
  assert.equal((await request('/api/dashboard',initial)).status,200);assert.equal((await request('/api/dashboard',initial)).status,409);
  assert.equal(await readFile(path.join(root,'observanda.json'),'utf8'),original);
  await app.close();app=await startServer({root,preferencesFile:file,port:0});assert.equal((await readPreferences(file)).dashboard.views[0].name,'Private dashboard title');
 }finally{await app.close();}
});


test('version 1 dashboard layouts upgrade in memory and preserve IDs, unknown tools and original bytes',async()=>{
 const root=await temp(),file=path.join(root,'preferences.json'),legacy=legacyDashboard(1);legacy.views[0].name='Sound studies';legacy.views[0].panels[0].tool='future-tool';legacy.views.forEach(v=>v.panels.forEach(p=>{delete p.config;delete p.height;}));
 const raw=JSON.stringify({formatVersion:1,workspace:null,dashboard:legacy});await writeFile(file,raw);
 const next=(await readPreferences(file)).dashboard;assert.equal(next.formatVersion,5);assert.equal(next.views[0].panels[0].id,'recent');assert.equal(next.views[0].panels[0].tool,'future-tool');assert.equal(next.views[0].panels[0].config.recordType,'all');assert.equal(await readFile(file,'utf8'),raw);
 const snapshot=dashboardSnapshot(next);await saveDashboard(file,next,snapshot.etag);assert.deepEqual((await readPreferences(file)).dashboard,next);
 const future={...next,formatVersion:99};assert.equal(upgradeDashboard(future),null);
});

test('panel queries combine stable project/notebook scope, record type, status and exact tag without changing research',()=>{
 const book=sampleNotebook(),panel=createPanel('records','filtered'),project=book.projects[0],notebook=book.notebooks[0],record=book.entries[0];record.status='completed';record.tags=['Bird'];
 const foreignProject={...project,id:randomUUID(),title:'Kitchen'},foreignNotebook={...notebook,id:randomUUID(),projectId:foreignProject.id};book.projects.push(foreignProject);book.notebooks.push(foreignNotebook);book.entries.push({...structuredClone(record),id:randomUUID(),notebookId:foreignNotebook.id,title:'Other work'});
 Object.assign(panel.config,{workspaceId:book.id,projectId:project.id,notebookId:notebook.id,recordType:record.type,status:'completed',tag:'Bird'});
 const before=JSON.stringify(book);assert.deepEqual(queryPanel(book,panel).entries.map(e=>e.id),[record.id]);assert.equal(JSON.stringify(book),before);
 panel.config.tag='bird';assert.equal(queryPanel(book,panel).entries.length,0);
 panel.config.tag='Bird';panel.config.notebookId=foreignNotebook.id;assert.match(queryPanel(book,panel).unavailable,/moved/);
 panel.config.notebookId=null;panel.config.workspaceId=randomUUID();assert.match(queryPanel(book,panel).unavailable,/another workspace/);
 panel.config.workspaceId=book.id;panel.config.projectId=randomUUID();assert.match(queryPanel(book,panel).unavailable,/unavailable/);
});

test('invalid panel filters are rejected and catalogue search uses names, purpose and categories',()=>{
 for(const config of [{recordType:'unknown'},{status:'approved'},{projectId:randomUUID()},{workspaceId:randomUUID(),notebookId:randomUUID()},{title:'x'.repeat(97)},{tag:'x'.repeat(41)},{workspaceId:'../private'}]){
  const v=defaultDashboard();Object.assign(v.views[0].panels[0].config,config);assert.equal(validDashboard(v),false);
 }
 assert.equal(matchesTool({name:'Media collection',description:'Images, audio and video',category:'Evidence'},' AUDIO evidence '),true);assert.equal(matchesTool({name:'Records',description:'Notes',category:'Work'},'audio'),false);
});

test('largest supported layout can be saved and reopened within the preferences file budget',async()=>{
 const root=await temp(),file=path.join(root,'preferences.json'),initial=dashboardSnapshot((await readPreferences(file)).dashboard),v=defaultDashboard();
 v.views=Array.from({length:20},(_,i)=>({id:'view-'+i,name:'x'.repeat(80),panels:Array.from({length:32},(_,j)=>{const panel=createPanel('r'.repeat(80),'p'.repeat(76)+j);Object.assign(panel.config,{title:'x'.repeat(96),tag:'z'.repeat(40),workspaceId:randomUUID(),projectId:randomUUID(),notebookId:randomUUID()});return panel;})}));v.defaultId=v.views[0].id;
 assert.equal(validDashboard(v),true);await saveDashboard(file,v,initial.etag);assert.deepEqual((await readPreferences(file)).dashboard,v);
});


test('version 2 dashboards retain their order and filters when gaining resizable panels',()=>{
 const legacy=legacyDashboard(2);legacy.views[0].panels.forEach(p=>delete p.height);legacy.views[0].panels[0].config.tag='acoustics';const raw=JSON.stringify(legacy),next=upgradeDashboard(legacy);assert.equal(JSON.stringify(legacy),raw);assert.equal(next.formatVersion,5);assert.equal(next.views[0].panels[0].config.tag,'acoustics');assert.equal(next.views[0].panels[0].height,0);
 for(const height of [-1,10001,NaN,2.5]){const invalid=structuredClone(next);invalid.views[0].panels[0].height=height;assert.equal(validDashboard(invalid),false);}
 next.views[0].panels[0].height=480;next.views[0].panels[0].width='half';assert.equal(validDashboard(next),true);
});
