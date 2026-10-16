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


test('project website management keeps its owner across website selection and leaves for workspace navigation',async()=>{
 const root=book(),a=book(),state={storage:{contextId:'root'},book:root},calls=[];
 const context=projectContexts({state,isOwned:id=>id===a.projects[0].id,api:async(route,data,options)=>{calls.push(options.owner);return response(options.owner?a:root);},adopt:result=>state.book=result.book});
 await context.beforeAction({dataset:{action:'site-list',project:a.projects[0].id}});assert.equal(state.projectOwner.projectId,a.projects[0].id);
 await context.beforeAction({dataset:{action:'site-open',id:randomUUID()}});await context.beforeAction({dataset:{action:'site-list'}});assert.equal(state.book,a);assert.deepEqual(calls,[a.projects[0].id]);
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
