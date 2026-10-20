import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {projectDirectoryChoices as query,projectDirectoryPage} from '../src/project-directory-query.js';
import {ownerDirectorySortKey} from '../src/owner-directory-model.js';
import {projectDirectoryChoices as controller} from '../src/web/project-directory-choices.js';
const row=(title,parentId=null,templateName=null)=>({projectId:randomUUID(),parentId,root:'Private root',vaultId:randomUUID(),summary:{title,templateName,description:'',kind:'Project'}});
const request=overrides=>({kind:'parents',exclude:null,query:'',offset:0,limit:25,revision:null,...overrides});
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function indexedRegistry(projects,{revision='first',onRead=()=>{},stats={}}={}){
 const active=projects.filter(entry=>!entry.legacy),inline=projects.filter(entry=>entry.legacy),byId=new Map(projects.map(entry=>[entry.projectId,entry]));
 const entries=index=>active.filter(entry=>index!=='template'||entry.summary?.templateName).map(entry=>({state:'active',entry,key:index==='parent'?(entry.parentId??'root')+':'+entry.projectId:ownerDirectorySortKey(index==='template'?entry.summary.templateName:entry.summary?.title??entry.projectId,entry.projectId)})).sort((a,b)=>a.key<b.key?-1:1);
 return {read(){assert.fail('Whole registry read');},directory(){assert.fail('Whole directory read');},inspect:async(use,{legacy=false}={})=>{
  onRead();return use({revision,legacy:legacy?inline:[],get:async id=>byId.has(id)?{state:'active',entry:byId.get(id)}:null,
   async page({index='label',offset=0,limit=50,prefix=''}){stats.pages=(stats.pages??0)+1;const all=entries(index).filter(row=>row.key.startsWith(prefix));return {items:all.slice(offset,offset+limit),total:all.length,next:null};},
   async *entries({index}){for(const row of entries(index)){stats.streamed=(stats.streamed??0)+1;yield row;}},
   async ancestors(id){stats.ancestors=(stats.ancestors??0)+1;const result=[],seen=new Set();for(let entry=byId.get(id);entry;entry=byId.get(entry.parentId)){if(seen.has(entry.projectId))throw {code:'FORMAT'};seen.add(entry.projectId);result.push(entry);}if(!result.length)throw {code:'NOT_FOUND'};return result;}
  });
 }};
}


test('directory choices page natural names, find accents and exclude a complete descendant branch without payload reads',async()=>{
 const projects=Array.from({length:71},(_,i)=>row('Project '+i)),branch=row('Branch'),child=row('Child',branch.projectId),grandchild=row('Grandchild',child.projectId),template=row('Écologie',null,'Water course');projects.push(branch,child,grandchild,template);
 let reads=0;const registry=indexedRegistry(projects,{onRead:()=>reads++});
 const first=await query(registry,request());assert.equal(first.total,75);assert.equal(first.projects.length,25);assert.deepEqual(first.projects.slice(4,7).map(p=>p.summary.title),['Project 0','Project 1','Project 2']);
 const second=await query(registry,request({offset:25,revision:first.revision}));assert.equal(second.projects.length,25);assert.ok(second.projects.every(p=>!first.projects.some(a=>a.projectId===p.projectId)));assert.deepEqual(Object.keys(second.projects[0]).sort(),['parentId','projectId','summary']);
 assert.deepEqual((await query(registry,request({query:'ecologie'}))).projects.map(p=>p.projectId),[template.projectId]);
 assert.equal((await query(registry,request({exclude:branch.projectId}))).total,72);
 assert.deepEqual((await query(registry,request({kind:'templates',query:'water'}))).projects.map(p=>p.projectId),[template.projectId]);
 assert.equal((await query(registry,request({kind:'templates',exclude:template.projectId}))).total,0);assert.equal(reads,6);
 await assert.rejects(query(registry,request({revision:'old'})),{code:'CONFLICT'});
 for(const invalid of [{limit:51},{offset:-1},{exclude:'invalid'},{query:'x'.repeat(161)},{kind:'anything'},{extra:true}])await assert.rejects(query(registry,request(invalid)),{code:'INVALID'});
});

test('directory choice replies cannot overwrite a newer query or another workspace and searches never mutate the authoring book',async()=>{
 const state={storage:{contextId:'a'},book:{title:'Untouched'}},requests=[],changes=[];
 const choices=controller({state,esc:s=>s,changed:kind=>changes.push(kind),api:(route,input)=>{const wait=deferred();requests.push({input,wait});return wait.promise;}});
 choices.start(null);choices.input({dataset:{projectChoiceSearch:'templates'},value:'latest'});
 requests[0].wait.resolve({projects:[row('Stale')],total:1,revision:'a'});await tick();assert.deepEqual(choices.rows('templates'),[]);
 await delay(220);assert.equal(requests.length,2);assert.equal(requests[1].input.query,'latest');const current=row('Current');requests[1].wait.resolve({projects:[current],total:1,revision:'b'});await tick();assert.deepEqual(choices.rows('templates'),[current]);
 choices.start(null);state.storage.contextId='b';requests[2].wait.resolve({projects:[row('Old workspace')],total:1,revision:'c'});await tick();assert.deepEqual(choices.rows('templates'),[]);assert.deepEqual(state.book,{title:'Untouched'});choices.reset();
});

test('directory pagination retries a changed index and retains chosen summaries across searches',async()=>{
 const state={storage:{contextId:'a'}},requests=[],first=row('First'),latest=row('Latest');let fail=true;
 const choices=controller({state,esc:s=>s,changed:()=>{},api:async(route,input)=>{requests.push(input);if(input.offset&&fail){fail=false;throw {code:'CONFLICT'};}return {projects:[fail?first:latest],total:2,revision:fail?'old':'new'};}});
 choices.start(null);await tick();await choices.action({dataset:{action:'project-choices-more',kind:'templates'}});assert.deepEqual(requests.map(r=>r.offset),[0,1,0]);assert.deepEqual(choices.rows('templates'),[latest]);assert.equal(choices.known(first.projectId).summary.title,'First');choices.reset();
});


test('record destinations include legacy ownership and readable ancestry without storage paths',async()=>{
 const parent=row('Ecology'),other=row('Astronomy'),a=row('Field work',parent.projectId),b=row('Field work',other.projectId),legacy={...row('Archive'),legacy:true},projects=[parent,other,a,b,legacy];
 const registry=indexedRegistry(projects,{revision:'r'});
 const result=await query(registry,request({kind:'record-parents',query:'ecology'}));
 assert.deepEqual(result.projects.map(p=>p.projectId),[parent.projectId,a.projectId]);
 assert.deepEqual(result.projects[1],{projectId:a.projectId,parentId:parent.projectId,summary:a.summary,ancestors:['Ecology'],legacy:false});
 const archived=await query(registry,request({kind:'record-parents',query:'Archive'}));assert.equal(archived.projects[0].legacy,true);
 assert.equal(JSON.stringify(result).includes('Private root'),false);
});


test('ordinary project and template pages seek the index without traversing unrelated owners',async()=>{
 const projects=Array.from({length:5000},(_,i)=>row('Project '+i,null,i%2?'Template '+i:null)),stats={},registry=indexedRegistry(projects,{stats});
 const result=await query(registry,request({offset:4995,limit:5}));assert.equal(result.total,5000);assert.deepEqual(result.projects.map(entry=>entry.summary.title),['Project 4995','Project 4996','Project 4997','Project 4998','Project 4999']);assert.equal(stats.streamed,undefined);assert.equal(stats.ancestors,undefined);assert.equal(stats.pages,1);
 const templates=await query(registry,request({kind:'templates',offset:2498,limit:2}));assert.equal(templates.total,2500);assert.equal(templates.projects.at(-1).summary.templateName,'Template 4999');assert.equal(stats.streamed,undefined);
 const list=await projectDirectoryPage(registry,{offset:4998,limit:2,revision:null});assert.equal(list.total,5000);assert.equal(list.projects.length,2);assert.equal(stats.streamed,undefined);
});

test('nested listing counts only registered direct children and binds the complete ancestry revision',async()=>{
 const root={...row('Historical parent'),legacy:true},parent=row('Parent',root.projectId),child=row('Child',parent.projectId),other=row('Other'),stats={},registry=indexedRegistry([root,parent,child,other],{stats});
 const page=await projectDirectoryPage(registry,{offset:0,limit:10,revision:null,parentId:parent.projectId});assert.deepEqual(page.projects,[child]);assert.deepEqual(page.ancestors,[root,parent]);assert.equal(page.total,1);assert.equal(stats.streamed,undefined);
 await assert.rejects(projectDirectoryPage(registry,{offset:0,limit:10,revision:'changed',parentId:parent.projectId}),{code:'CONFLICT'});
 const choices=await query(registry,request({kind:'record-parents'}));assert.equal(choices.total,4);assert.equal(choices.projects.find(entry=>entry.projectId===root.projectId).legacy,true);
 const bookParents=await query(registry,request({kind:'book-parents'}));assert.equal(bookParents.total,3);assert.equal(bookParents.projects.some(entry=>entry.projectId===root.projectId),false);
});
