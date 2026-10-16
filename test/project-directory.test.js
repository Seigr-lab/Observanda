import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectDirectory} from '../src/web/project-directory.js';
const row=(parentId=null)=>({projectId:randomUUID(),parentId,summary:{title:'Directory project',description:'',kind:'Project'}});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve};};

test('directory pagination combines summaries without modifying authoring state and restarts a changed page',async()=>{
 const rows=[row(),row()],book={id:randomUUID(),title:'Workspace',projects:[],notebooks:[],entries:[]},state={book,storage:{researchStorage:'catalogue',contextId:'workspace'}},requests=[];let conflict=false;
 const directory=projectDirectory({state,esc:s=>s,changed:()=>{},api:async(route,input)=>{requests.push(input);assert.equal(route,'/api/projects/list');if(input.offset&&conflict){conflict=false;throw {code:'CONFLICT'};}return {projects:input.offset?rows.slice(1):rows.slice(0,1),total:2,revision:'a',ancestors:[]};}});
 await directory.refresh();assert.equal(directory.navigation(book).projects.length,1);assert.equal(book.projects.length,0);
 await directory.action({dataset:{action:'project-directory-more',parent:''}});assert.equal(directory.navigation(book).projects.length,2);assert.equal(requests.at(-1).offset,1);
 conflict=true;await directory.action({dataset:{action:'project-directory-more',parent:''}});assert.equal(directory.navigation(book).projects.length,1);assert.equal(requests.at(-1).offset,0);
 state.storage.contextId='new';assert.equal(directory.navigation(book).projects.length,0);
});

test('a late directory reply cannot leak a previous workspace into the selected one',async()=>{
 const wait=deferred(),state={book:{projects:[]},storage:{researchStorage:'catalogue',contextId:'first'}};let paints=0;
 const directory=projectDirectory({state,api:()=>wait.promise,esc:s=>s,changed:()=>paints++});const loading=directory.refresh();state.storage.contextId='second';wait.resolve({projects:[row()],ancestors:[],total:1,revision:'old'});await loading;assert.equal(directory.entries().length,0);assert.equal(paints,0);
});


test('directory hierarchy validation visits a deep project chain once and still rejects cycles and missing parents',async()=>{
 const {ProjectRegistry}=await import('../src/project-registry.js'),{default:path}=await import('node:path');const workspaceId=randomUUID(),registry=new ProjectRegistry({root:path.resolve('fixture')},workspaceId),projects=[];
 for(let n=0;n<12000;n++)projects.push({projectId:randomUUID(),root:path.resolve('fixture',String(n)),vaultId:randomUUID(),namespaceId:randomUUID(),parentId:projects.at(-1)?.projectId??null,summary:null});
 // Validate from the deepest child first: an implementation that walks every
 // ancestor again would visit seventy million links for this directory.
 const value={version:2,workspaceId,projects:projects.toReversed()};let reads=0;
 for(const entry of value.projects){const parent=entry.parentId;Object.defineProperty(entry,'parentId',{enumerable:true,configurable:true,get(){reads++;return parent;}});}
 registry.validate(value);assert.ok(reads<=projects.length*5,String(reads));
 const broken=structuredClone(value);broken.projects.at(-1).parentId=broken.projects[0].projectId;assert.throws(()=>registry.validate(broken),{code:'FORMAT'});
 broken.projects.at(-1).parentId=randomUUID();assert.throws(()=>registry.validate(broken),{code:'FORMAT'});
});


test('only completed directory commands invalidate summaries after a disconnected opening',async()=>{
 const state={book:{projects:[]},storage:{researchStorage:'catalogue',contextId:'workspace'}},requests=[];
 const directory=projectDirectory({state,esc:s=>s,changed:()=>{},api:async(route,input)=>{requests.push(route);return {projects:[],ancestors:[],total:0,revision:'a'};}}),operation={id:randomUUID(),kind:'/api/projects/open',state:'running'};
 const update=()=>directory.activity({contextId:'workspace',operations:[operation]});await update();await update();assert.equal(requests.length,0);
 operation.state='completed';await update();await update();assert.deepEqual(requests,['/api/projects/list']);
 await directory.activity({contextId:'another',operations:[{...operation,id:randomUUID()}]});assert.equal(requests.length,1);
 await directory.activity({contextId:'workspace',operations:[operation,{id:randomUUID(),kind:'/api/projects/'+randomUUID()+'/research/records/writing/save',state:'completed'}]});assert.equal(requests.length,1);
});


test('deleted identities cannot alias live projects or remain hierarchy parents',async()=>{
 const {ProjectRegistry}=await import('../src/project-registry.js'),{default:path}=await import('node:path'),workspaceId=randomUUID(),registry=new ProjectRegistry({root:path.resolve('fixture')},workspaceId),project={projectId:randomUUID(),root:path.resolve('fixture/a'),namespaceId:randomUUID(),vaultId:randomUUID(),parentId:null,summary:null},deleted={projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),operationId:randomUUID()};
 const value={version:3,workspaceId,projects:[project],deleted:[deleted]};assert.equal(registry.validate(value),value);
 for(const key of ['projectId','namespaceId','vaultId']){const invalid=structuredClone(value);invalid.deleted[0][key]=project[key];assert.throws(()=>registry.validate(invalid),{code:'FORMAT'});}
 const child=structuredClone(value);child.projects[0].parentId=deleted.projectId;assert.throws(()=>registry.validate(child),{code:'FORMAT'});
 const duplicate=structuredClone(value);duplicate.deleted.push({...deleted});assert.throws(()=>registry.validate(duplicate),{code:'FORMAT'});
});


test('book navigation uses the current parent name and refreshes only after completed settings saves',async()=>{
 const parent=row(),state={book:{projects:[{id:parent.projectId,title:'Original parent'}]},projectOwner:{projectId:parent.projectId,labBookId:randomUUID()},storage:{researchStorage:'catalogue',contextId:'workspace'}},requests=[];
 const directory=projectDirectory({state,esc:s=>s,changed:()=>{},api:async(route,input)=>{requests.push(input);return {projects:input.parentId?[]:[parent],ancestors:input.parentId?[parent]:[],total:input.parentId?0:1,revision:'a'};}});
 await directory.refresh();assert.equal(directory.navigation(state.book).projects[0].title,parent.summary.title);assert.equal(state.book.projects[0].title,'Original parent');
 const before=requests.length,operation={id:randomUUID(),kind:'/api/projects/'+parent.projectId+'/settings/save',state:'running'};await directory.activity({contextId:'workspace',operations:[operation]});assert.equal(requests.length,before);
 parent.summary.title='Renamed parent';operation.state='completed';await directory.activity({contextId:'workspace',operations:[operation]});assert.equal(requests.length,before+2);assert.equal(directory.navigation(state.book).projects[0].title,'Renamed parent');
 await directory.activity({contextId:'workspace',operations:[operation]});assert.equal(requests.length,before+2);
});


test('document workspaces keep their local projects without requesting an unavailable directory',async()=>{
 const project={id:randomUUID(),title:'Local project'},book={id:randomUUID(),projects:[project]},state={book,page:'projects',storage:{contextId:'workspace',researchStorage:'document'}},requests=[];
 const directory=projectDirectory({state,esc:s=>s,changed:()=>{},api:async(route)=>{requests.push(route);throw new Error('Unsupported directory requested');}});
 directory.bind();await directory.refresh();await directory.action({dataset:{action:'project-directory-retry',parent:''}});
 await directory.activity({contextId:'workspace',operations:[{id:randomUUID(),kind:'/api/projects/open',state:'completed'}]});
 assert.deepEqual(requests,[]);assert.equal(directory.cards(null),'');assert.deepEqual(directory.navigation(book).projects,[project]);
});

test('switching storage formats discards a pending directory reply and preserves encrypted directory failures',async()=>{
 const wait=deferred(),state={book:{projects:[]},storage:{contextId:'workspace',researchStorage:'catalogue'}};let paints=0,fail=false;
 const directory=projectDirectory({state,esc:s=>s,changed:()=>paints++,api:()=>{if(fail)throw {code:'ACCESS_LOCKED',message:'Unlock this workspace'};return wait.promise;}});
 const loading=directory.refresh();state.storage.researchStorage='document';wait.resolve({projects:[row()],ancestors:[],total:1,revision:'old'});await loading;
 assert.equal(directory.entries().length,0);assert.equal(directory.cards(null),'');assert.equal(paints,0);
 state.storage.researchStorage='catalogue';fail=true;await directory.refresh();assert.match(directory.cards(null),/Unlock this workspace/);assert.match(directory.cards(null),/project-directory-retry/);assert.equal(paints,1);
 fail=false;await directory.action({dataset:{action:'project-directory-retry',parent:''}});assert.equal(directory.entries().length,1);assert.doesNotMatch(directory.cards(null),/Unlock this workspace/);
});
