import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {canvasResourceURL} from '../src/web/website-canvas-resources.js';
import {websiteContext,publicationPreviewUrl} from '../src/web/website-context.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectContexts,projectApiRoute,projectRoute,ownedRoute,researchContext,projectContextAPI,researchOwner} from '../src/web/project-context.js';
const book=(id=randomUUID())=>({id,projects:[{id:randomUUID(),parentId:null}],notebooks:[],entries:[]});
const response=metadata=>({metadata,total:0,totalBytes:0,etag:'a'.repeat(64),cursor:'first',notebookCounts:Object.fromEntries(metadata.notebooks.map(n=>[n.id,0]))});
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};

test('project routes keep workspace preferences separate from research authoring',()=>{
 const id=randomUUID(),owner={projectId:id};
 for(const route of ['/api/research/records/writing/save','/api/research/drafts/list','/api/workspace/read/start','/api/workspace/structure','/api/workspace/save','/api/websites/open','/api/website/research/content','/api/publishing','/api/publication-jobs/start','/api/export/'+randomUUID(),'/api/modules/items','/api/v1/intake/readiness','/api/research/materials/chunk/'+randomUUID()+'/0'])assert.equal(projectApiRoute(route,id),'/api/projects/'+id+route.slice(4));
 for(const route of ['/api/storage','/api/dashboard','/api/access/status','/api/interface','/api/projects/list'])assert.equal(projectApiRoute(route,id),route);
 assert.deepEqual(projectRoute(ownedRoute('#/records/'+randomUUID()+'/read',owner)).projectId,id);
 assert.deepEqual(projectRoute('#/preferences/general'),{projectId:null,hash:'#/preferences/general'});
});

test('late project selection cannot replace a newer selection or workspace navigation',async()=>{
 const root=book(),a=book(),b=book(),pending=new Map(),state={storage:{contextId:'root'},book:root},seen=[];
 const context=projectContexts({state,api:async(route,data,options)=>{assert.equal(route,'/api/workspace/read/start');const wait=deferred();pending.set(options.owner,wait);return wait.promise;},adopt:result=>{state.book=result.book;seen.push(result.book.id);}});
 delete b.projects[0].parentId;
 const first=context.enter(a.projects[0].id),firstRejected=assert.rejects(first,{name:'AbortError'});
 const second=context.enter(b.projects[0].id);pending.get(b.projects[0].id).resolve(response(b));await second;
 const key=researchContext(state);pending.get(a.projects[0].id).resolve(response(a));await firstRejected;assert.equal(researchContext(state),key);assert.deepEqual(seen,[b.id]);assert.equal(context.root(),root);
 const returning=context.enter(null);pending.get(null).resolve(response(root));await returning;assert.equal(state.book,root);assert.equal(state.projectOwner,null);
 const third=context.enter(a.projects[0].id),thirdRejected=assert.rejects(third,{name:'AbortError'});await context.beforeAction({dataset:{action:'preferences'}});pending.get(a.projects[0].id).resolve(response(a));await thirdRejected;assert.equal(state.book,root);
});

test('invalid project data and an expired workspace cannot change selected ownership',async()=>{
 const root=book(),a=book(),state={storage:{contextId:'root'},book:root};let next=response(root);
 const context=projectContexts({state,api:async()=>next,adopt:result=>state.book=result.book});
 await assert.rejects(context.enter(a.projects[0].id),{code:'WORKSPACE_READ_INVALID'});assert.equal(state.book,root);assert.equal(state.projectOwner,undefined);
 const wait=deferred();next=wait.promise;const reading=context.enter(a.projects[0].id),rejected=assert.rejects(reading,{name:'AbortError'});state.storage.contextId='another workspace';wait.resolve(response(a));await rejected;assert.equal(state.book,root);
});


test('website management leaves research ownership and keeps independent website selection at workspace level',async()=>{
 const root=book(),a=book(),state={storage:{contextId:'root'},book:root},calls=[];
 const context=projectContexts({state,isOwned:id=>id===a.projects[0].id,api:async(route,data,options)=>{calls.push(options.owner);return response(options.owner?a:root);},adopt:result=>state.book=result.book});
 await context.enter(a.projects[0].id);assert.equal(state.projectOwner.projectId,a.projects[0].id);
 await context.beforeAction({dataset:{action:'site-list',project:a.projects[0].id}});assert.equal(state.projectOwner,null);assert.equal(state.book,root);
 await context.beforeAction({dataset:{action:'site-open',id:randomUUID()}});await context.beforeAction({dataset:{action:'site-list'}});assert.equal(state.book,root);assert.deepEqual(calls,[a.projects[0].id,null]);
 await context.beforeAction({dataset:{action:'publishing'}});assert.equal(state.projectOwner,null);assert.equal(state.book,root);
});


test('publication and canvas asset addresses preserve the project owner',()=>{
 const id=randomUUID(),asset=randomUUID(),edition='a'.repeat(64),state={storage:{contextId:'root'},projectOwner:{projectId:id},websiteId:randomUUID()},other={...state,projectOwner:{projectId:randomUUID()}};
 assert.notEqual(websiteContext(state),websiteContext(other));
 const base='http://localhost'+publicationPreviewUrl(state,edition,'entries/observation.html'),media='../media/'+asset+'.png';
 assert.equal(canvasResourceURL(media,base,'root'),'http://localhost/api/projects/'+id+'/media/'+asset+'?context=root');
 assert.equal(canvasResourceURL(media,'http://localhost/preview/'+edition+'/entries/observation.html','root'),'http://localhost/api/media/'+asset+'?context=root');
 assert.equal(canvasResourceURL('https://example.com/media/image.png',base,'root'),'https://example.com/media/image.png');
});


test('review requests follow the selected project while device preferences retain their owner',()=>{
 const id=crypto.randomUUID();assert.equal(projectApiRoute('/api/reviews/list',id),'/api/projects/'+id+'/reviews/list');assert.equal(projectApiRoute('/api/reviews/create',id),'/api/projects/'+id+'/reviews/create');assert.equal(projectApiRoute('/api/security/collaboration-identity/status',id),'/api/security/collaboration-identity/status');
});


test('review snapshot admission allows only nonmutating review operations',()=>{
 for(const name of ['plan','identity','list','read','export'])assert.equal(workspaceSnapshotRequest('POST','/api/reviews/'+name),true);
 for(const name of ['create','contact','untrust','import','respond','unknown'])assert.equal(workspaceSnapshotRequest('POST','/api/reviews/'+name),false);
 assert.equal(workspaceSnapshotRequest('GET','/api/reviews/create'),false);
});


test('deferred data providers keep their owner when navigation changes before a read starts',async()=>{
 const {createDataRegistry,createDataSession}=await import('../src/web/data-registry.js');
 const registry=createDataRegistry(),a=randomUUID(),b=randomUUID(),pending=[],calls=[];
 let context={projectOwner:{projectId:a}},selected=a;
 registry.register({id:'deferred',label:'Deferred data',load:({api})=>api('/api/workspace/read/dashboard'),items:(context,data)=>data??[]});
 const session=createDataSession(registry,{context:()=>context,onChange:()=>{},api:(route,data,options)=>new Promise(resolve=>{calls.push(options?.owner??selected);pending.push(resolve);})});
 try{
  assert.equal(session.read('deferred').status,'loading');context={projectOwner:{projectId:b}};selected=b;
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[a]);
  assert.equal(session.read('deferred').status,'loading');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[a,b]);
  pending[0]([{key:'old',title:'Old owner',data:{}}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(session.read('deferred').status,'loading');
  pending[1]([{key:'current',title:'Current owner',data:{}}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(session.read('deferred').items[0].key,'current');
 }finally{session.close();}
});


test('lab-book context keeps routes, previews and deferred reads in the selected book',async()=>{
 const projectId=randomUUID(),labBookId=randomUUID(),other=randomUUID(),owner={projectId,labBookId},state={storage:{contextId:'root'},projectOwner:owner};
 const route='/api/research/records/writing/save',prefix='/api/projects/'+projectId+'/lab-books/'+labBookId;
 assert.equal(projectApiRoute(route,owner),prefix+route.slice(4));assert.equal(projectApiRoute('/api/interface',owner),'/api/interface');
 const hash=ownedRoute('#/records/'+randomUUID()+'/read',owner);assert.deepEqual(projectRoute(hash),{...owner,hash:'#'+hash.split('/books/'+labBookId)[1]});
 assert.notEqual(researchContext(state),researchContext({...state,projectOwner:{projectId,labBookId:other}}));
 assert.notEqual(websiteContext(state),websiteContext({...state,projectOwner:{projectId,labBookId:other}}));
 const edition='c'.repeat(64),asset=randomUUID(),base='http://localhost'+publicationPreviewUrl(state,edition,'entries/record.html');
 assert.equal(canvasResourceURL('../media/'+asset+'.png',base,'root'),'http://localhost'+prefix+'/media/'+asset+'?context=root');
 const calls=[],captured=projectContextAPI((route,data,options)=>calls.push(options.owner),state);state.projectOwner={projectId,labBookId:other};captured(route,{});assert.deepEqual(calls,[owner]);
 assert.deepEqual(researchOwner(state),{projectId,labBookId:other});
});

test('book selection validates its catalogue and returning to its project restores project ownership',async()=>{
 const root=book(),project=book(),projectId=project.projects[0].id,a={...book(),projects:project.projects},b={...book(),projects:project.projects};
 a.notebooks=[{id:randomUUID(),projectId}];b.notebooks=[{id:randomUUID(),projectId}];const labBookId=a.notebooks[0].id,state={storage:{contextId:'root'},book:root};
 let wrong=false;const context=projectContexts({state,isOwned:id=>id===projectId,bookOwner:id=>id===labBookId?{projectId,labBookId}:null,api:async(route,data,{owner})=>response(typeof owner==='object'&&owner!==null?(wrong?b:a):owner?project:root),adopt:result=>{state.book=result.book;}});
 await context.enter(projectId);wrong=true;await assert.rejects(context.enter(projectId,labBookId),{code:'WORKSPACE_READ_INVALID'});assert.equal(state.book,project);
 wrong=false;await context.beforeAction({dataset:{action:'filter-notebook',id:labBookId}});assert.equal(state.book,a);assert.equal(state.projectOwner.labBookId,labBookId);
 await context.beforeAction({dataset:{action:'open-project',id:projectId}});assert.equal(state.book,project);assert.equal(state.projectOwner.labBookId,undefined);
 await context.restore(ownedRoute('#/entries',{projectId,labBookId}));assert.equal(state.book,a);await context.beforeAction({dataset:{action:'preferences'}});assert.equal(state.book,root);
});

test('data-provider results from a sibling book cannot replace the selected book',async()=>{
 const {createDataRegistry,createDataSession}=await import('../src/web/data-registry.js'),registry=createDataRegistry(),projectId=randomUUID(),a=randomUUID(),b=randomUUID(),pending=[],calls=[];
 let context={projectOwner:{projectId,labBookId:a}};registry.register({id:'book',label:'Book records',load:({api})=>api('/api/workspace/read/dashboard'),items:(context,data)=>data??[]});
 const session=createDataSession(registry,{context:()=>context,onChange:()=>{},api:(route,data,{owner})=>new Promise(resolve=>{calls.push(owner);pending.push(resolve);})});
 try{
  session.read('book');context={projectOwner:{projectId,labBookId:b}};await new Promise(resolve=>setImmediate(resolve));session.read('book');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{projectId,labBookId:a},{projectId,labBookId:b}]);pending[0]([{key:'a',title:'First',data:{}}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(session.read('book').status,'loading');pending[1]([{key:'b',title:'Second',data:{}}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(session.read('book').items[0].key,'b');
 }finally{session.close();}
});


test('relocation preserves the requested book owner without adopting incomplete metadata',async()=>{
 const root=book(),projectId=randomUUID(),labBookId=randomUUID(),operationProjectId=randomUUID(),state={storage:{contextId:'root'},book:root};let adopted=false;
 const context=projectContexts({state,api:async()=>{throw {code:'STORAGE_RENAMING',projectId:operationProjectId};},adopt:()=>{adopted=true;}});
 await assert.rejects(context.enter(projectId,labBookId),error=>{assert.equal(error.projectId,operationProjectId);assert.deepEqual(error.requestedOwner,{projectId,labBookId});return error.code==='STORAGE_RENAMING';});
 assert.equal(adopted,false);assert.equal(state.book,root);assert.equal(state.projectOwner,undefined);
 await context.beforeAction({dataset:{action:'preferences'}});assert.equal(state.book,root);
});

for(const outcome of ['success','failure'])test('late owner initialization '+outcome+' cannot fail or replace newer workspace navigation',async()=>{
 const root=book(),project=book(),state={storage:{contextId:'root'},book:root},entered=deferred(),finish=deferred(),returning=deferred(),finishRoot=deferred();
 const context=projectContexts({state,api:async(route,data,{owner})=>response(owner?project:root),adopt:result=>{state.book=result.book;},afterEnter:async result=>{if(result.book.id===project.id){entered.resolve();await finish.promise;}else{returning.resolve();await finishRoot.promise;}}});
 const first=context.enter(project.projects[0].id),cancelled=assert.rejects(first,{name:'AbortError'});await entered.promise;assert.equal(context.pending(),true);
 const second=context.beforeAction({dataset:{action:'workspace'}});await returning.promise;
 if(outcome==='failure')finish.reject({code:'WORKSPACE_CHANGED'});else finish.resolve();
 await cancelled;assert.equal(state.book,root);assert.equal(state.projectOwner,null);assert.equal(context.pending(),true);
 finishRoot.resolve();await second;assert.equal(context.pending(),false);
});

test('current owner initialization errors remain actionable',async()=>{
 const root=book(),project=book(),state={storage:{contextId:'root'},book:root};
 const error={code:'ACCESS_LOCKED',projectId:project.projects[0].id};
 const context=projectContexts({state,api:async()=>response(project),adopt:result=>{state.book=result.book;},afterEnter:async()=>{throw error;}});
 await assert.rejects(context.enter(project.projects[0].id),value=>value===error);
 assert.equal(state.book,project);assert.equal(state.projectOwner.projectId,project.projects[0].id);assert.equal(context.pending(),false);
});

test('changing or resetting the workspace cancels its pending owner activation',async()=>{
 for(const invalidate of ['reset','workspace']){
  const root=book(),project=book(),state={storage:{contextId:'root'},book:root},entered=deferred(),finish=deferred();
  const context=projectContexts({state,api:async()=>response(project),adopt:result=>{state.book=result.book;},afterEnter:async()=>{entered.resolve();await finish.promise;}});
  const pending=context.enter(project.projects[0].id),cancelled=assert.rejects(pending,{name:'AbortError'});await entered.promise;assert.equal(context.pending(),true);
  if(invalidate==='reset')context.reset();else state.storage.contextId='another';
  assert.equal(context.pending(),false);finish.resolve();await cancelled;assert.equal(context.pending(),false);
 }
});

for(const outcome of ['success','failure'])test('requests for the same owner await its existing initialization '+outcome,async()=>{
 const root=book(),project=book(),state={storage:{contextId:'root'},book:root},metadata=deferred(),entered=deferred(),finish=deferred(),failure={code:'ACCESS_LOCKED'};let reads=0,initializations=0;
 const context=projectContexts({state,api:async()=>{reads++;return metadata.promise;},adopt:result=>{state.book=result.book;},afterEnter:async()=>{initializations++;entered.resolve();await finish.promise;}});
 const first=context.enter(project.projects[0].id),duringRead=context.enter(project.projects[0].id);
 const firstResult=outcome==='failure'?assert.rejects(first,error=>error===failure):first;
 const readResult=outcome==='failure'?assert.rejects(duringRead,error=>error===failure):duringRead;
 metadata.resolve(response(project));await entered.promise;
 const duringInitialization=context.enter(project.projects[0].id),initializedResult=outcome==='failure'?assert.rejects(duringInitialization,error=>error===failure):duringInitialization;
 let settled=false;void initializedResult.then(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);assert.equal(context.pending(),true);assert.equal(reads,1);assert.equal(initializations,1);
 if(outcome==='failure')finish.reject(failure);else finish.resolve();
 await Promise.all([firstResult,readResult,initializedResult]);assert.equal(context.pending(),false);assert.equal(state.book,project);
});


test('sidebar project tools retain the dedicated project instead of returning to workspace storage',async()=>{
 const root=book(),project=book(),projectId=project.projects[0].id,state={storage:{contextId:'root'},book:root},calls=[];
 const context=projectContexts({state,isOwned:id=>id===projectId,api:async(route,data,{owner})=>{calls.push(owner);return response(owner?project:root);},adopt:result=>state.book=result.book});
 await context.enter(projectId);
 await context.beforeAction({dataset:{action:'module-open',moduleId:'resources',modulePath:'scope/'+projectId+'/resource',moduleProjectId:projectId},closest:selector=>selector==='#workspace-navigation'?{}:null});
 assert.equal(state.projectOwner?.projectId,projectId);assert.equal(state.book.id,project.id);assert.deepEqual(calls,[projectId]);
});


test('explicit module targets separate workspace, legacy project and nested book ownership',async()=>{
 const root=book(),project=book(),other=book(),projectId=project.projects[0].id,otherId=other.projects[0].id,legacyId=root.projects[0].id,labBookId=randomUUID();
 const nested={...book(),projects:project.projects,notebooks:[{id:labBookId,projectId}]},state={storage:{contextId:'root'},book:root},calls=[];
 const context=projectContexts({state,isOwned:id=>[projectId,otherId].includes(id),api:async(route,data,{owner})=>{calls.push(owner);return response(typeof owner==='object'&&owner!==null?nested:owner===projectId?project:owner===otherId?other:root);},adopt:result=>state.book=result.book});
 const target=id=>({dataset:{action:'module-open',moduleId:'planning',modulePath:'scope/'+id+'/agenda',moduleProjectId:id}});
 await context.enter(projectId,labBookId);
 await context.beforeAction({dataset:{action:'module-open',moduleId:'scientific-calculator'}});assert.equal(state.projectOwner.labBookId,labBookId);
 await context.beforeAction(target(projectId));assert.equal(state.book,project);assert.equal(state.projectOwner.labBookId,undefined);
 await context.beforeAction(target(otherId));assert.equal(state.book,other);assert.equal(state.projectOwner.projectId,otherId);
 await context.beforeAction({dataset:{action:'module-open',moduleId:'scientific-calculator',moduleWorkspace:'true'}});assert.equal(state.book,root);assert.equal(state.projectOwner,null);
 await context.enter(projectId,labBookId);await context.beforeAction(target(legacyId));assert.equal(state.book,root);assert.equal(state.projectOwner,null);
 const count=calls.length;await assert.rejects(context.beforeAction(target('invalid')),{name:'TypeError'});assert.equal(calls.length,count);
 assert.deepEqual(calls,[{projectId,labBookId},projectId,otherId,null,{projectId,labBookId},null]);
});


test('workspace and project body tool controls declare valid navigation owners',async()=>{
 const {locationToolsView}=await import('../src/web/modules/location-tools.js'),root=book(),project=book(),projectId=project.projects[0].id,state={book:root,storage:{contextId:'root'},dashboardSettings:{enabledModules:['resources','planning']}};
 project.projects[0].tools=['resources','planning'];
 const context=projectContexts({state,isOwned:id=>id===projectId,api:async(route,data,{owner})=>response(owner?project:root),adopt:result=>state.book=result.book});
 const renderTarget=id=>{
  const html=locationToolsView(state,id,value=>String(value)),button=html.match(/<button[^>]*data-module-id="resources"[^>]*>/)?.[0];assert.ok(button);
  const dataset={action:'module-open',moduleId:'resources'};
  for(const [attribute,key] of [['data-module-workspace','moduleWorkspace'],['data-module-project-id','moduleProjectId']]){const value=button.match(new RegExp(attribute+'="([^"]*)"'))?.[1];if(value!==undefined)dataset[key]=value;}
  return {dataset};
 };
 const workspaceButton=renderTarget(null);assert.equal(workspaceButton.dataset.moduleWorkspace,'true');assert.equal(workspaceButton.dataset.moduleProjectId,undefined);
 await context.enter(projectId);const projectButton=renderTarget(projectId);assert.equal(projectButton.dataset.moduleProjectId,projectId);assert.equal(projectButton.dataset.moduleWorkspace,undefined);
 await context.beforeAction(workspaceButton);assert.equal(state.projectOwner,null);
 await context.beforeAction(projectButton);assert.equal(state.projectOwner.projectId,projectId);
});

for(const outcome of ['success','failure'])test('cancelling a pending owner read preserves same-owner navigation on '+outcome,async()=>{
 const root=book(),project=book(),state={storage:{contextId:'root'},book:root,page:'record-reader'},metadata=deferred(),seen=[];
 const context=projectContexts({state,api:()=>metadata.promise,adopt:result=>{state.book=result.book;seen.push(result.book.id);}});
 const opening=context.enter(project.projects[0].id),cancelled=assert.rejects(opening,{name:'AbortError'});
 assert.equal(context.pending(),true);context.cancelPending();assert.equal(context.pending(),false);state.page='module';
 await context.beforeAction({dataset:{action:'module-open',moduleId:'scientific-calculator'}});
 if(outcome==='failure')metadata.reject({code:'ACCESS_LOCKED'});else metadata.resolve(response(project));
 await cancelled;assert.deepEqual(seen,[]);assert.equal(state.book,root);assert.equal(state.projectOwner,undefined);assert.equal(state.page,'module');assert.equal(context.root(),root);
});

for(const outcome of ['success','failure'])test('cancelling owner initialization prevents its late '+outcome+' from completing navigation',async()=>{
 const root=book(),project=book(),state={storage:{contextId:'root'},book:root,page:'record-reader'},entered=deferred(),finish=deferred();
 const context=projectContexts({state,api:async()=>response(project),adopt:result=>{state.book=result.book;},afterEnter:async()=>{entered.resolve();await finish.promise;}});
 const opening=context.enter(project.projects[0].id),cancelled=assert.rejects(opening,{name:'AbortError'});await entered.promise;
 context.cancelPending();assert.equal(context.pending(),false);state.page='module';
 if(outcome==='failure')finish.reject({code:'ACCESS_LOCKED'});else finish.resolve();
 await cancelled;assert.equal(state.page,'module');assert.equal(state.book,project);assert.equal(state.projectOwner.projectId,project.projects[0].id);assert.equal(context.root(),root);
});

test('a replacement owner activation coalesces independently of the cancelled read',async()=>{
 const root=book(),project=book(),state={storage:{contextId:'root'},book:root},reads=[],entered=deferred(),finish=deferred();let initializations=0;
 const context=projectContexts({state,api:()=>{const wait=deferred();reads.push(wait);return wait.promise;},adopt:result=>{state.book=result.book;},afterEnter:async()=>{initializations++;entered.resolve();await finish.promise;}});
 const old=context.enter(project.projects[0].id),cancelled=assert.rejects(old,{name:'AbortError'});context.cancelPending();
 const replacement=context.enter(project.projects[0].id),coalesced=context.enter(project.projects[0].id);assert.equal(reads.length,2);
 reads[0].resolve(response(project));await cancelled;assert.equal(state.book,root);assert.equal(context.pending(),true);
 reads[1].resolve(response(project));await entered.promise;const initialized=context.enter(project.projects[0].id);assert.equal(reads.length,2);assert.equal(initializations,1);
 finish.resolve();await Promise.all([replacement,coalesced,initialized]);assert.equal(context.pending(),false);assert.equal(state.book,project);assert.equal(context.root(),root);
 context.cancelPending();assert.equal(state.book,project);assert.equal(state.projectOwner.projectId,project.projects[0].id);
});

test('owner initialization exposes its lifetime before applying delayed owner settings',async()=>{
 const root=book(),project=book(),state={storage:{contextId:'root'},book:root,mediaPolicy:'current'},entered=deferred(),finish=deferred();let current;
 const context=projectContexts({state,api:async()=>response(project),adopt:result=>{state.book=result.book;},afterEnter:async(result,lifetime)=>{current=lifetime.current;assert.equal(current(),true);entered.resolve();await finish.promise;if(current())state.mediaPolicy='obsolete';}});
 const opening=context.enter(project.projects[0].id),cancelled=assert.rejects(opening,{name:'AbortError'});await entered.promise;
 context.cancelPending();assert.equal(current(),false);finish.resolve();await cancelled;assert.equal(state.mediaPolicy,'current');
});
