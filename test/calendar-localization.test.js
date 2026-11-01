import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {validateCatalogue} from '../src/web/i18n/runtime.js';
import {localCalendar} from '../src/web/modules/calendar-model.js';
import {ownerDescriptor,ownerLabel} from '../src/web/modules/scope.js';
import {calendarSourceName,calendarSourceOwner,calendarEventOrigin,calendarSourceError} from '../src/web/modules/calendar-presentation.js';
import {calendarUI} from '../src/web/modules/calendar-ui.js';
import {createDataRegistry} from '../src/web/data-registry.js';
import {registerCombinedCalendar} from '../src/web/modules/calendar-data.js';
import {CalendarSources} from '../src/calendar/service.js';
import {AppError} from '../src/errors.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const catalogue=locale=>readFile(new URL('../src/web/locales/'+locale+'/calendar.json',import.meta.url),'utf8').then(JSON.parse);
const load=async locale=>{await prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(locale);};

test('calendar and dashboard presentation translate generated labels while preserving authored names and scope identities',async context=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window={innerWidth:500};globalThis.document={activeElement:null,querySelector:()=>null};
 context.after(()=>{globalThis.window=oldWindow;globalThis.document=oldDocument;activateLanguage('en');});
 const book={id:'workspace',title:'My <workspace>',projects:[{id:'project',title:'Removed location',parentId:null,tools:['planning']}]};
 const entities=[null,'project','missing'].map((projectId,index)=>({id:'task-'+index,type:'task',data:{projectId,title:'Authored <task> '+index,dueOn:'2026-10-29',status:'todo'}}));
 entities.push({id:'authored-calendar',type:'calendar',data:{projectId:null,name:'Task deadlines',color:'#123456',archived:false}});
 const original=structuredClone({book,entities}),data=localCalendar(book,entities),events=data.events.map(event=>({...event,source:data.sources.find(source=>source.id===event.sourceId)}));
 const response={workspaceId:book.id,version:'version',sources:data.sources,events,total:events.length,offset:0,cursor:'events',nextCursor:null,previousCursor:null,sourceErrors:[],sourcePage:{offset:0,total:data.sources.length,cursor:'sources',nextCursor:null,previousCursor:null}};
 const state={page:'module',moduleId:'planning',modulePath:'scope/workspace/agenda',book,storage:{contextId:'context'}};
 const ui=calendarUI({state,api:async()=>response,esc,render:()=>{},showDialog:()=>{},notify:()=>{}},{navigation:()=>'',activate:async()=>{},dispose:()=>{}});context.after(()=>ui.dispose());await ui.activate({});
 const registry=createDataRegistry();registerCombinedCalendar(registry);const provider=registry.get('calendar-agenda'),english=await catalogue('en');
 for(const locale of ['en','ca','es','nb','nn']){
  const messages=await catalogue(locale);validateCatalogue(messages,english);assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());await load(locale);
  assert.equal(calendarSourceName(data.sources.find(source=>source.id==='tasks:workspace')),messages.taskDeadlines);
  assert.equal(calendarSourceName(data.sources.find(source=>source.id==='authored-calendar')),'Task deadlines');
  assert.equal(calendarSourceOwner(data.sources.find(source=>source.id==='tasks:project')),'Removed location');
  assert.equal(calendarSourceOwner(data.sources.find(source=>source.id==='tasks:missing')),t('moduleEditors','removedLocation'));
  assert.equal(calendarSourceOwner(data.sources.find(source=>source.id==='tasks:workspace')),t('moduleEditors','workspaceName',{name:book.title}));
  assert.equal(calendarEventOrigin({origin:'Remote / Workspace',originDisplay:{kind:'workspace',name:'Remote'}}),t('moduleEditors','workspaceName',{name:'Remote'}));
  assert.equal(calendarEventOrigin({origin:'Remote / Workspace',originDisplay:{kind:'location',name:'Remote / Workspace'}}),'Remote / Workspace');
  assert.equal(calendarEventOrigin({origin:'Unrecognized authored origin'}),'Unrecognized authored origin');
  const html=ui.view(state.modulePath);assert.ok(html.includes(esc(messages.taskDeadlines)));assert.ok(html.includes(esc(t('moduleEditors','workspaceName',{name:book.title}))));assert.ok(html.includes('Authored &lt;task&gt;'));assert.ok(!html.includes('<workspace>'));
  assert.equal(provider.label,messages.combined);const item=provider.items({book},response)[0];assert.equal(item.data.calendar,messages.taskDeadlines);assert.equal(item.data.owner,t('moduleEditors','workspaceName',{name:book.title}));assert.equal(item.action.data.modulePath,'scope/workspace/agenda');
  assert.equal(ownerLabel(book,null),'My <workspace> / Workspace');assert.deepEqual(localCalendar(book,entities),data);assert.deepEqual({book,entities},original);
 }
 assert.deepEqual(ownerDescriptor(book,'project'),{kind:'location',name:'Removed location'});assert.deepEqual(ownerDescriptor(book,'missing'),{kind:'removed',name:''});
});

test('calendar source failures carry display metadata while keeping their English protocol messages',async context=>{
 context.after(()=>activateLanguage('en'));
 const book={id:'workspace',title:'Authored name',projects:[]},entity={id:'subscription',type:'subscription',data:{name:'Authored calendar',projectId:null,color:'#123456',url:'https://example.invalid/calendar',enabled:true}};
 let error=Error('Private fetch detail');const service=new CalendarSources({read:async()=>({revision:1,sources:[],events:[],connections:[entity]}),fetch:async()=>{throw error;}}),workspace={outline:async()=>({metadata:book})},range={from:'2026-10-01',to:'2026-11-01',timeZone:'UTC'};
 const generic=(await service.data(workspace,range)).sources[0];assert.equal(generic.error,'Calendar could not refresh.');assert.equal(generic.errorKey,'refreshFailed');assert.deepEqual(generic.ownerDisplay,{kind:'workspace',name:book.title});
 error=new AppError('CALENDAR_LOCKED');const locked=(await service.data(workspace,range,{refresh:true})).sources[0];assert.equal(locked.errorCode,'CALENDAR_LOCKED');assert.equal(locked.error,error.message);
 for(const locale of ['en','ca','es','nb','nn']){await load(locale);assert.equal(calendarSourceError(generic),t('calendar','refreshFailed'));assert.equal(calendarSourceError(locked),t('errors','CALENDAR_LOCKED'));assert.equal(calendarSourceError({...locked,errorKey:'sourceChanged'}),t('calendar','sourceChanged'));}
 assert.equal(calendarSourceError({error:'Unknown source diagnostic'}),'Unknown source diagnostic');service.clear();
});
