import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectPublicationSource} from '../src/project-publication-sources.js';
const fixture=()=>{
 const workspaceId=randomUUID(),first='a'.repeat(64),second='b'.repeat(64),state={heads:0,reads:[],mismatched:false};
 const store={head:async()=>++state.heads===1?first:second,snapshot:async revision=>{state.reads.push(revision);return {metadata:{id:state.mismatched?randomUUID():workspaceId,title:revision===first?'Before':'After',projects:[],notebooks:[],privateSettings:{secret:'not a publication selector field'}}};}};
 const registry={workspaceId,read:async()=>({revision:'stable',value:{projects:[]}})},application={registry:async()=>registry,workspace:{catalogue:fn=>fn(store)},tracked:fn=>fn()};
 const command={workspaceId,sourceId:workspaceId,operation:'head',query:{}};return {state,application,command,first};
};
test('publication source head returns metadata and revision from the same snapshot',async()=>{
 const f=fixture(),result=await projectPublicationSource(f.application,{},f.command);
 assert.equal(result.value.snapshotId,f.first);assert.equal(result.value.title,'Before');assert.equal(f.state.heads,1);assert.deepEqual(f.state.reads,[f.first]);assert.equal('privateSettings' in result.value,false);assert.deepEqual(result.owner,{workspaceId:f.command.workspaceId,projectId:null,labBookId:null});
});
test('publication source rejects mismatched ownership, malformed reads and cancellation',async()=>{
 const f=fixture();await assert.rejects(projectPublicationSource(f.application,{}, {...f.command,query:{snapshotId:'invalid'}}),{code:'INVALID'});assert.equal(f.state.heads,0);
 await assert.rejects(projectPublicationSource(f.application,{}, {...f.command,operation:'content',query:{workspaceId:randomUUID(),snapshotId:f.first}}),{code:'INVALID'});assert.equal(f.state.heads,0);
 const controller=new AbortController();controller.abort();await assert.rejects(projectPublicationSource(f.application,{}, f.command,{signal:controller.signal}),{name:'AbortError'});assert.equal(f.state.heads,0);
 f.state.mismatched=true;await assert.rejects(projectPublicationSource(f.application,{},f.command),{code:'DATABASE_LOCATION'});
});


test('an authorized source head can reopen the immutable snapshot used by its canvas',async()=>{
 const f=fixture(),snapshotId='c'.repeat(64),result=await projectPublicationSource(f.application,{}, {...f.command,query:{snapshotId}});
 assert.equal(result.value.snapshotId,snapshotId);assert.deepEqual(f.state.reads,[snapshotId]);
});
