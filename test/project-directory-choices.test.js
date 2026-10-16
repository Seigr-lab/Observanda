import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {projectDirectoryChoices as query} from '../src/project-directory-query.js';
import {projectDirectoryChoices as controller} from '../src/web/project-directory-choices.js';
const row=(title,parentId=null,templateName=null)=>({projectId:randomUUID(),parentId,root:'Private root',vaultId:randomUUID(),summary:{title,templateName,description:'',kind:'Project'}});
const request=overrides=>({kind:'parents',exclude:null,query:'',offset:0,limit:25,revision:null,...overrides});
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('directory choices page natural names, find accents and exclude a complete descendant branch without payload reads',async()=>{
 const projects=Array.from({length:71},(_,i)=>row('Project '+i)),branch=row('Branch'),child=row('Child',branch.projectId),grandchild=row('Grandchild',child.projectId),template=row('Écologie',null,'Water course');projects.push(branch,child,grandchild,template);
 let reads=0;const registry={directory:async()=>{reads++;return {revision:'first',value:{projects},projects};}};
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
 const registry={directory:async()=>({revision:'r',projects})};
 const result=await query(registry,request({kind:'record-parents',query:'ecology'}));
 assert.deepEqual(result.projects.map(p=>p.projectId),[parent.projectId,a.projectId]);
 assert.deepEqual(result.projects[1],{projectId:a.projectId,parentId:parent.projectId,summary:a.summary,ancestors:['Ecology'],legacy:false});
 const archived=await query(registry,request({kind:'record-parents',query:'Archive'}));assert.equal(archived.projects[0].legacy,true);
 assert.equal(JSON.stringify(result).includes('Private root'),false);
});
