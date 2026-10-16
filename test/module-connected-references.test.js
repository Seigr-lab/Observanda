import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {connectedReferencePages} from '../src/web/module-connected-references.js';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:value=>resolve(value),reject:error=>reject(error)};};
const fixture=()=>({page:'module',moduleId:'resources',modulePath:'resource/'+id(),section:'connections',book:{id:id()},storage:{contextId:id()},projectOwner:{projectId:id()}});
function response(state,target,items=[]){return {workspaceId:state.book.id,target,items,offset:0,total:items.length,cursor:'page',previousCursor:null,nextCursor:null,partial:false,unavailable:[],unavailableTotal:0};}
function create(state,api,draw=()=>{}){return connectedReferencePages({state,api,esc,draw,prefix:'inventory-links',action:'module-command',active:()=>state.page==='module'&&state.moduleId==='resources'&&state.section==='connections',identity:()=>JSON.stringify([state.modulePath,state.section])});}
test('configured connected pages preserve addressed source identities and dispatch only their commands',async()=>{
 const state=fixture(),target={workspaceId:state.book.id,type:'resource',id:id()},source=id(),same=id(),calls=[];
 const items=[state.book.id,source].map(workspaceId=>({reference:{workspaceId,type:'task',id:same},title:'Task',openType:'task',openId:same,owner:{workspaceId,projectId:id(),labBookId:null}}));
 const pages=create(state,async(path,body,options)=>{calls.push({path,body,options});return response(state,target,items);});
 await pages.load({reference:target});assert.deepEqual(pages.page.items,items);assert.equal(calls[0].body.workspaceId,state.book.id);assert.equal(calls[0].options.adopt,false);assert.equal(await pages.action('stock-operation'),false);assert.equal(await pages.action('inventory-ledger'),false);assert.equal(await pages.action('inventory-links-unknown'),false);
 assert.match(pages.view(item=>esc(item.title)),/data-action="module-command" data-command="inventory-links-next"/);assert.equal(await pages.action('inventory-links-refresh'),true);assert.equal(calls.length,2);
});
test('busy incoming reads do not swallow unrelated stock operations',async()=>{
 const state=fixture(),target={workspaceId:state.book.id,type:'resource',id:id()},held=deferred(),pages=create(state,()=>held.promise);const reading=pages.load({reference:target});assert.equal(pages.busy,true);assert.equal(await pages.action('stock-operation'),false);held.resolve(response(state,target));await reading;assert.equal(pages.busy,false);
});
for(const [name,change] of [['section',s=>s.section='stock'],['editor',s=>s.modulePath='resource/'+id()],['owner',s=>s.projectOwner={projectId:id()}],['navigation',s=>s.page='preferences']])test('late incoming success and locked failure are dropped after '+name+' changes',async()=>{
 for(const fail of [false,true]){const state=fixture(),target={workspaceId:state.book.id,type:'resource',id:id()},held=deferred();let draws=0;const pages=create(state,()=>held.promise,()=>draws++),reading=pages.load({reference:target}),before=draws;change(state);if(fail)held.reject({code:'ACCESS_LOCKED',message:'Private obsolete source'});else held.resolve(response(state,target));await reading;assert.equal(pages.page,null);assert.equal(draws,before);assert.doesNotMatch(pages.view(()=>''),/Private obsolete source/);}
});
test('partial incoming results render available rows without unavailable owner labels and retry after a request error',async()=>{
 const state=fixture(),target={workspaceId:state.book.id,type:'resource',id:id()};let fail=true;
 const pages=create(state,async()=>{if(fail)throw Error('Interrupted page');return {...response(state,target),partial:true,unavailableTotal:1,unavailable:[{workspaceId:id(),projectId:id(),labBookId:null,code:'ACCESS_LOCKED'}]};});
 await pages.load({reference:target});assert.match(pages.view(()=>''),/Interrupted page/);fail=false;assert.equal(await pages.action('inventory-links-retry'),true);assert.match(pages.view(()=>''),/Some locations could not be checked/);assert.doesNotMatch(pages.view(()=>''),/ACCESS_LOCKED/);
});
test('record connected-work defaults keep existing control dispatch',async()=>{
 const state={...fixture(),page:'record-reader',selected:id()},target={workspaceId:state.book.id,type:'record',id:state.selected};let count=0;
 const pages=connectedReferencePages({state,api:async()=>{count++;return response(state,target);},esc,draw:()=>{}});await pages.load({reference:target});assert.match(pages.view(()=>''),/data-action="connected-work-page" data-command="connected-next"/);await pages.action('connected-refresh');assert.equal(count,2);
});

test('Inventory legacy Connections retain local queries and do not swallow stock actions',async()=>{
 const {inventoryClient}=await import('../src/web/modules/inventory-client.js'),state={...fixture(),storage:{contextId:id(),researchStorage:'legacy'},dashboardSettings:{enabledModules:['resources','planning']}},resource=id(),task=id(),calls=[];
 const previous=globalThis.document;globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};
 const c={services:{state,api:async(path,body)=>{calls.push({path,body});if(path.endsWith('/inventory/stock'))return {workspaceId:state.book.id,revision:1,items:[{id:resource,revision:1,data:{name:'Stock'},locations:[]}]};if(path.endsWith('/items'))return {workspaceId:state.book.id,revision:1,items:[{id:task,type:'task',title:'Legacy task',description:'',revision:1,openType:'task',openId:task}],offset:0,total:1,cursor:'local',nextCursor:null,previousCursor:null};throw Error(path);}},current:{id:resource,type:'resource',expectedRevision:1},section:'connections',scopeId:null,recursive:true,snapshot:{revision:1},esc,button:(label,command,attrs='')=>'<button data-command="'+command+'" '+attrs+'>'+label+'</button>',bindItemLabels:()=>{}};
 const client=inventoryClient(c,{card:()=>'',stock:()=>'',bom:()=>''});try{client.bind();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(call=>call.path.endsWith('/items')).length,1);assert.equal(calls.some(call=>call.path.includes('/references/')),false);assert.match(client.connectionView(),/Legacy task/);assert.match(client.connectionView(),/data-action="module-open"/);assert.equal(await client.action('stock-operation',{}),false);c.section='stock';client.bind();assert.doesNotMatch(client.connectionView(),/Legacy task/);c.section='connections';c.current.expectedRevision=null;client.bind();const count=calls.length;assert.match(client.connectionView(),/data-command="inventory-links-refresh" disabled/);await client.action('inventory-links-refresh',{});assert.equal(calls.length,count);}finally{client.stop();globalThis.document=previous;}
});

for(const code of ['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN','RECORD_QUERY_CURSOR'])test('current '+code+' invalidates previously visible source labels',async()=>{
 const state=fixture(),target={workspaceId:state.book.id,type:'resource',id:id()},source=id(),sourceId=id(),item={reference:{workspaceId:source,type:'task',id:sourceId},title:'Previously authorized task',openType:'task',openId:sourceId,owner:{workspaceId:source,projectId:id(),labBookId:null,projectTitle:'Previously authorized owner'}};let failure=null;
 const pages=create(state,async()=>{if(failure)throw failure;return response(state,target,[item]);});await pages.load({reference:target});assert.equal(pages.page.items.length,1);failure={code,message:'Source access changed'};await pages.action('inventory-links-refresh');assert.equal(pages.page,null);const html=pages.view(row=>row.title+' '+row.owner.projectTitle);assert.doesNotMatch(html,/Previously authorized|No matching items/);assert.match(html,/Source access changed/);
});
test('ordinary incoming network failure retains the last authorized page',async()=>{
 const state=fixture(),target={workspaceId:state.book.id,type:'resource',id:id()},sourceId=id(),item={reference:{workspaceId:state.book.id,type:'task',id:sourceId},title:'Retained task',openType:'task',openId:sourceId,owner:{workspaceId:state.book.id,projectId:null,labBookId:null}};let failure=false;
 const pages=create(state,async()=>{if(failure)throw Error('Network interrupted');return response(state,target,[item]);});await pages.load({reference:target});failure=true;await pages.action('inventory-links-refresh');assert.deepEqual(pages.page.items,[item]);assert.match(pages.view(row=>row.title),/Retained task/);
});

for(const code of ['ACCESS_LOCKED','RECORD_QUERY_CURSOR','NETWORK'])test(code+' retry uses the correct source discovery cursor',async()=>{
 const state=fixture(),target={workspaceId:state.book.id,type:'resource',id:id()},calls=[];let count=0;
 const pages=create(state,async(_route,body)=>{calls.push(body.cursor);if(++count===2)throw {code,message:'Interrupted'};return response(state,target);});await pages.load({reference:target},'previously-valid-page');await pages.load({reference:target},'previously-valid-page');await pages.action('inventory-links-retry');assert.deepEqual(calls,['previously-valid-page','previously-valid-page',code==='NETWORK'?'previously-valid-page':null]);assert.equal(pages.page.total,0);
});
