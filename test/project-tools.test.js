import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {saveStructure} from '../src/structure.js';
import {projectUsesTool,projectToolScope} from '../src/web/project-tools.js';
import {locationTools} from '../src/web/modules/location-tools.js';
import {toolItems} from '../src/web/modules/scope.js';
import {localCalendar,visibleCalendar} from '../src/web/modules/calendar-model.js';
import {registerResources} from '../src/web/modules/operations-data.js';

function setup(){
 const book=sampleNotebook(),parent=book.projects[0],child={...parent,id:randomUUID(),parentId:parent.id,title:'Studio'},other={...parent,id:randomUUID(),title:'Field work'};
 book.projects.push(child,other);return {book,parent,child,other};
}
const choose=(book,moduleId,projectIds)=>saveStructure(book,{kind:'project-tools',value:{moduleId,projectIds}}).book;

test('old and new projects never adopt tools implicitly; choices are independent of ancestors and availability',()=>{
 const {book,parent,child,other}=setup();book.formatVersion=15;const before=structuredClone(book),next=upgradeNotebook(book);
 assert.equal(next.formatVersion,21);assert.deepEqual(book,before);
 const settings={enabledModules:['resources','planning']};
 for(const p of next.projects)assert.deepEqual(locationTools(settings,next,p.id),[]);
 const chosen=choose(next,'resources',[child.id]);
 assert.equal(projectUsesTool(chosen,parent.id,'resources'),false);
 assert.equal(projectToolScope(chosen,parent.id,'resources'),'overview');
 assert.equal(projectToolScope(chosen,child.id,'resources'),'own');
 assert.equal(projectToolScope(chosen,other.id,'resources'),null);
 assert.deepEqual(locationTools(settings,chosen,child.id).map(m=>m.id),['resources']);
 assert.deepEqual(locationTools({enabledModules:[]},chosen,child.id),[]);
 assert.deepEqual(choose(chosen,'resources',[]).entries,book.entries);
 assert.equal(projectUsesTool(next,child.id,'resources'),false);
});

test('project selection accepts future module IDs, retains other choices, validates edits atomically',()=>{
 const {book,parent,child}=setup(),custom={id:'future-tool',label:'Future',locationTool:{label:'Future',path:'items',types:['future']},navigation:[]};
 const chosen=choose(choose(book,'future-tool',[child.id]),'planning',[parent.id]);
 assert.deepEqual(locationTools({enabledModules:['future-tool']},chosen,child.id,[custom]).map(m=>m.id),['future-tool']);
 const next=choose(chosen,'resources',[child.id]);
 assert.deepEqual(next.projects.find(p=>p.id===child.id).tools,['future-tool','resources']);
 const before=structuredClone(next);
 for(const value of [{moduleId:'../bad',projectIds:[]},{moduleId:'resources',projectIds:[randomUUID()]},{moduleId:'resources',projectIds:[child.id,child.id]}])
  assert.throws(()=>saveStructure(next,{kind:'project-tools',value}),{code:'INVALID'});
 assert.deepEqual(next,before);
 for(const tools of [['resources','resources'],['bad id'],'resources']){
  const invalid=structuredClone(next);invalid.projects[0].tools=tools;assert.throws(()=>validateNotebook(invalid));
 }
});

test('project adoption controls navigation while workspace inventory retains all owned items',async()=>{
 const {book,child,other}=setup(),a=randomUUID(),b=randomUUID(),movement=randomUUID();
 const entities=[{id:a,type:'resource',data:{projectId:child.id,name:'Instrument',kind:'equipment'}},{id:b,type:'resource',data:{projectId:other.id,name:'Field kit',kind:'equipment'}},{id:movement,type:'movement',data:{resourceId:a,delta:'1'}}],before=structuredClone(entities);
 const chosen=choose(book,'resources',[child.id]);
 assert.deepEqual(toolItems(chosen,entities,'resources').map(e=>e.id),[a,movement]);
 const providers=[];registerResources({register:p=>providers.push(p)});
 const provider=providers.find(p=>p.id==='resources'),context={book:chosen},page=await provider.load({context,api:async(route,request)=>{
  assert.equal(route,'/api/modules/inventory/dashboard');assert.deepEqual(new Set(request.scopeIds),new Set([null,...chosen.projects.map(project=>project.id)]));assert.equal(request.type,'resource');
  return {workspaceId:chosen.id,items:entities.filter(entity=>entity.type==='resource').map(entity=>({key:entity.id,title:entity.data.name,data:entity.data})),offset:0,total:2,cursor:'first-page',previousCursor:null,nextCursor:null};
 }});
 assert.deepEqual(provider.items(context,page).map(e=>e.key),[a,b]);
 const disabled=choose(chosen,'resources',[]);
 assert.deepEqual(toolItems(disabled,entities,'resources'),[]);
 assert.deepEqual(toolItems(choose(disabled,'resources',[child.id]),entities,'resources').map(e=>e.id),[a,movement]);
 assert.deepEqual(entities,before);
});

test('combined calendars include only selected project sources and preserve events through disable and re-enable',()=>{
 const {book,child,parent}=setup(),calendar=randomUUID();
 const entities=[{id:calendar,type:'calendar',data:{projectId:child.id,name:'Studio',color:'#3958ba',archived:false}},{id:randomUUID(),type:'event',data:{calendarId:calendar,title:'Session',status:'confirmed',allDay:true,startsAt:'2026-10-01',endsAt:'2026-10-02'}}];
 const data=localCalendar(book,entities);
 assert.equal(visibleCalendar(book,data).events.length,0);
 const chosen=choose(book,'planning',[child.id]);
 assert.equal(visibleCalendar(chosen,data,{projectId:parent.id}).events.length,1);
 assert.equal(visibleCalendar(chosen,data,{projectId:parent.id,recursive:false}).events.length,0);
 assert.equal(visibleCalendar(choose(chosen,'planning',[]),data).events.length,0);
 assert.equal(data.events.length,1);
});

test('project-capable features retain the shared selector alongside dedicated feature settings',async()=>{
 const {FEATURE_MODULES}=await import('../src/web/feature-modules.js');
 const {moduleSettings}=await import('../src/web/module-settings.js');
 const feature={id:'future-composite',label:'Future composite',locationTool:{label:'Future',path:'items'},createSettings:()=>({}),settingsLabel:'Dedicated settings'};
 FEATURE_MODULES.push(feature);
 try{
  const host=moduleSettings({esc:v=>v,state:{},notify:()=>{}}),html=host.view(feature);
  assert.match(html,/Choose projects/);assert.match(html,/Dedicated settings/);
  assert.match(html,/data-module-settings-id="future-composite:projects"/);
  assert.match(html,/data-module-settings-id="future-composite"/);
 }finally{FEATURE_MODULES.splice(FEATURE_MODULES.indexOf(feature),1);}
});
