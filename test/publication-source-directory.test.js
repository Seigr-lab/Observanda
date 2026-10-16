import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationSourceDirectory} from '../src/publication-source-directory.js';
const fixture=()=>{
 const workspaceId=randomUUID(),projects=Array.from({length:125},(_,i)=>({projectId:randomUUID(),namespaceId:randomUUID(),parentId:null,summary:{title:'Project '+String(i).padStart(3,'0')}}));
 projects[1].parentId=projects[0].projectId;projects[3].summary.title=projects[2].summary.title;
 const state={revision:'first'},registry={workspaceId,read:async()=>({revision:state.revision,value:{projects}})},application={registry:async()=>registry,workspace:{root:'Workspace',catalogue(){throw Error('Discovery opened record storage');}}};
 const command={workspaceId,projectId:null,search:'',offset:0,limit:25,revision:null};return {application,projects,command,state};
};
test('publication source discovery pages owner identities without opening record storage',async()=>{
 const f=fixture(),first=await publicationSourceDirectory(f.application,{},f.command),rows=[...first.items];
 assert.equal(first.total,125);assert.equal(first.items.length,25);assert.deepEqual(first.items.find(row=>row.projectId===f.projects[1].projectId).ancestors,['Project 000']);
 for(let offset=25;offset<125;offset+=25)rows.push(...(await publicationSourceDirectory(f.application,{}, {...f.command,offset,revision:first.revision})).items);
 assert.equal(new Set(rows.map(row=>row.workspaceId)).size,125);assert.ok(rows.every(row=>!('root' in row)&&!('vaultId' in row)));
 const found=await publicationSourceDirectory(f.application,{}, {...f.command,search:'Project 002'});assert.equal(found.total,2);assert.notEqual(found.items[0].workspaceId,found.items[1].workspaceId);
 f.state.revision='second';await assert.rejects(publicationSourceDirectory(f.application,{}, {...f.command,offset:25,revision:first.revision}),{code:'CONFLICT'});
});
test('source discovery validates the host, limits, cancellation and hierarchy',async()=>{
 const f=fixture();await assert.rejects(publicationSourceDirectory(f.application,{}, {...f.command,limit:51}),{code:'INVALID'});await assert.rejects(publicationSourceDirectory(f.application,{}, {...f.command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const controller=new AbortController();controller.abort();await assert.rejects(publicationSourceDirectory(f.application,{},f.command,{signal:controller.signal}),{name:'AbortError'});
 f.projects[0].parentId=f.projects[1].projectId;await assert.rejects(publicationSourceDirectory(f.application,{},f.command),{code:'FORMAT'});
});
