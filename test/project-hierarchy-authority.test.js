import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verifyProjectDirectoryHierarchy} from '../src/project-hierarchy-authority.js';
const inline=(parentId=null)=>({id:randomUUID(),parentId});
const native=(projectId=randomUUID(),parentId=null,state='active')=>({state,entry:{projectId,parentId}});
function view(rows){const byId=new Map(rows.map(row=>[row.entry.projectId,row]));let reads=0;return {get reads(){return reads;},async get(id){reads++;return byId.get(id)??null;},async page({index,prefix,limit}){assert.equal(index,'parent');return {items:rows.filter(row=>row.state==='active'&&row.entry.parentId+':'===prefix).slice(0,limit)};},async read(){throw Error('Unrelated native owners must not be loaded');}};}
test('inline hierarchy edits reject mixed native cycles and orphaning without reading unrelated owners',async()=>{
 const parent=inline(),child=native(undefined,parent.id),directory=view([child,...Array.from({length:5000},()=>native())]);
 await verifyProjectDirectoryHierarchy(directory,[parent],[{...parent,title:'Renamed'}]);assert.ok(directory.reads<5);
 await assert.rejects(verifyProjectDirectoryHierarchy(directory,[parent],[]),{code:'FORMAT'});
 await assert.rejects(verifyProjectDirectoryHierarchy(directory,[parent],[{...parent,parentId:child.entry.projectId}]),{code:'FORMAT'});
 const other=inline();await verifyProjectDirectoryHierarchy(directory,[parent],[other,{...parent,parentId:other.id}]);
});
test('native identities shadow retained inline entries while removed and relocated parents remain unavailable',async()=>{
 const historical=inline(),child=inline(historical.id),active=native(historical.id),directory=view([active]);
 await verifyProjectDirectoryHierarchy(directory,[historical],[child]);
 for(const state of ['deleted','relocated'])await assert.rejects(verifyProjectDirectoryHierarchy(view([native(historical.id,null,state)]),[historical],[historical,child]),{code:'FORMAT'});
 await assert.rejects(verifyProjectDirectoryHierarchy(view([]),[],[child]),{code:'FORMAT'});
 const a=inline(),b=inline(a.id);a.parentId=b.id;await assert.rejects(verifyProjectDirectoryHierarchy(view([]),[],[a,b]),{code:'FORMAT'});
});
