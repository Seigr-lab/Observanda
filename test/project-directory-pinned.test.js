import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {projectDirectoryChoices} from '../src/project-directory-query.js';
import {projectChoiceAncestry} from '../src/project-choice-ancestry.js';
import {ownerDirectorySortKey} from '../src/owner-directory-model.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {clearVault} from '../src/encryption.js';
import {queryCacheMemoryFiles} from './fixtures/query-cache-memory.js';
const row=(title,parentId=null)=>({projectId:randomUUID(),parentId,root:'Not a returned field',summary:{title}});
const request=overrides=>({kind:'record-parents',exclude:null,query:'ecologie',offset:0,limit:25,revision:null,...overrides});
function fixture(count){
 const first=row('Écologie'),second=row('Astronomy'),rows=[first,second,...Array.from({length:count},(_,i)=>row('Project '+i,i%2?first.projectId:second.projectId))],byId=new Map(rows.map(entry=>[entry.projectId,entry])),stats={streamed:0,get:0,present:0};
 const workspaceId=randomUUID(),workspace={root:path.resolve('synthetic-project-choice',workspaceId),vault:{id:randomUUID(),key:randomBytes(32)}},view={revision:'a'.repeat(64),legacy:[],async get(id){stats.get++;return byId.has(id)?{state:'active',entry:byId.get(id)}:null;},async *entries(){for(const entry of [...rows].sort((a,b)=>ownerDirectorySortKey(a.summary.title,a.projectId).localeCompare(ownerDirectorySortKey(b.summary.title,b.projectId)))){stats.streamed++;yield {entry,key:ownerDirectorySortKey(entry.summary.title,entry.projectId)};}},async ancestors(id){stats.present++;const result=[];for(let entry=byId.get(id);entry;entry=byId.get(entry.parentId))result.push(entry);return result;},page(){assert.fail('Filtered choices must not use a whole registry page');}};
 const registry={workspace,workspaceId,inspect:operation=>operation(view)},reset=()=>Object.keys(stats).forEach(key=>stats[key]=0);return {registry,workspace,view,stats,reset,rows,first};
}
test('filtered project choice continuations seek cached results and hydrate only requested ancestry',async t=>{
 t.mock.method(pinnedQueryResults,'open',queryCacheMemoryFiles);const f=fixture(10000);
 try{
  const first=await projectDirectoryChoices(f.registry,request());assert.equal(first.total,5001);assert.equal(first.projects.length,25);assert.equal(f.stats.streamed,10002);assert.equal(f.stats.get,2);assert.equal(f.stats.present,25);assert.equal(JSON.stringify(first).includes('Not a returned field'),false);f.reset();
  const second=await projectDirectoryChoices(f.registry,request({offset:25,revision:first.revision}));assert.equal(second.total,5001);assert.equal(second.projects.length,25);assert.ok(second.projects.every(row=>!first.projects.some(prior=>prior.projectId===row.projectId)));assert.deepEqual(f.stats,{streamed:0,get:0,present:25});
  const exhausted=await projectDirectoryChoices(f.registry,request({offset:99999,revision:first.revision}));assert.deepEqual(exhausted.projects,[]);assert.equal(exhausted.total,5001);
  const other=await projectDirectoryChoices(f.registry,request({query:'astronomy',revision:first.revision}));assert.equal(other.total,5001);assert.ok(other.projects.every(value=>value.projectId!==f.first.projectId&&value.ancestors.every(title=>title!=='Écologie')));
  f.view.revision='b'.repeat(64);await assert.rejects(projectDirectoryChoices(f.registry,request({offset:25,revision:first.revision})),{code:'CONFLICT'});
  t.diagnostic(JSON.stringify({owners:10002,firstParentProofs:2,continuedCandidateReads:0,pageAncestryHydrations:25}));
 }finally{await clearVault(f.workspace.vault);}
});
test('streamed ancestor search preserves cross-label matches and excludes the entire selected branch',async t=>{
 t.mock.method(pinnedQueryResults,'open',queryCacheMemoryFiles);const f=fixture(0),parent=row('Parent',f.first.projectId),child=row('Child',parent.projectId),entries=[f.first,parent,child],byId=new Map(entries.map(row=>[row.projectId,row]));
 f.view.entries=async function*(){for(const entry of entries)yield {entry,key:ownerDirectorySortKey(entry.summary.title,entry.projectId)};};f.view.get=async id=>byId.has(id)?{state:'active',entry:byId.get(id)}:null;f.view.ancestors=async id=>{const rows=[];for(let entry=byId.get(id);entry;entry=byId.get(entry.parentId))rows.push(entry);return rows;};
 try{
  const matches=await projectDirectoryChoices(f.registry,request({query:'parent ecologie'}));assert.deepEqual(matches.projects.map(row=>row.projectId),[child.projectId]);
  const parents=await projectDirectoryChoices(f.registry,request({kind:'parents',query:'',exclude:parent.projectId}));assert.deepEqual(parents.projects.map(row=>row.projectId),[f.first.projectId]);
 }finally{await clearVault(f.workspace.vault);}
});
test('bounded ancestry traversal detects deep cycles, missing parents and cancellation',async()=>{
 const entries=Array.from({length:4000},(_,i)=>({projectId:String(i),parentId:i===3999?null:String(i+1)})),byId=new Map(entries.map(row=>[row.projectId,row]));let reads=0;const view={get:async id=>{reads++;return byId.has(id)?{state:'active',entry:byId.get(id)}:null;}};
 let count=0;for await(const _row of projectChoiceAncestry(view)(entries[0]))count++;assert.equal(count,4000);assert.equal(reads,3999);
 entries.at(-1).parentId='2000';await assert.rejects(async()=>{for await(const _row of projectChoiceAncestry(view)(entries[0])){}},{code:'FORMAT'});
 entries.at(-1).parentId='missing';await assert.rejects(async()=>{for await(const _row of projectChoiceAncestry(view)(entries[0])){}},{code:'NOT_FOUND'});
 const controller=new AbortController();await assert.rejects(async()=>{for await(const _row of projectChoiceAncestry(view,{signal:controller.signal})(entries[0]))controller.abort();},{name:'AbortError'});
});
