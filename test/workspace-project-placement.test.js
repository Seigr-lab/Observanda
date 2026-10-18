import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {workspaceProjectPlacements,legacyWorkspaceProjectDestination} from '../src/workspace-project-placement.js';
const base=path.resolve('synthetic-workspace-placements'),source=path.join(base,'Source'),destination=path.join(base,'Copy');
const entry=(root,parentId=null)=>({projectId:randomUUID(),root,parentId});
const rejects=entries=>assert.throws(()=>workspaceProjectPlacements(source,destination,entries),{code:'STORAGE_PATH'});
test('external project trees retain literal parent folders and unrelated siblings',()=>{
 const parent=entry(path.join(base,'External Parent')),child=entry(path.join(parent.root,'Child observations 2'),parent.projectId),leaf=entry(path.join(child.root,'Further observations'),child.projectId),sibling=entry(path.join(parent.root,'Other child'),parent.projectId),internal=entry(path.join(source,'Internal'));
 const rows=workspaceProjectPlacements(source,destination,[leaf,sibling,internal,child,parent]),byId=new Map(rows.map(row=>[row.projectId,row]));
 assert.equal(byId.get(parent.projectId).destination,path.join(destination,'External Parent'));
 assert.equal(byId.get(child.projectId).destination,path.join(byId.get(parent.projectId).destination,'Child observations 2'));
 assert.equal(byId.get(leaf.projectId).destination,path.join(byId.get(child.projectId).destination,'Further observations'));
 assert.equal(byId.get(sibling.projectId).destination,path.join(byId.get(parent.projectId).destination,'Other child'));
 assert.equal(byId.get(internal.projectId).destination,path.join(destination,'Internal'));
 assert.ok(rows.indexOf(byId.get(parent.projectId))<rows.indexOf(byId.get(child.projectId)));
 assert.ok(rows.indexOf(byId.get(child.projectId))<rows.indexOf(byId.get(leaf.projectId)));
});
test('existing valid receipt destinations remain exact and displaced completed layouts refuse resume',()=>{
 const parent=entry(path.join(source,'Parent')),child=entry(path.join(parent.root,'Child'),parent.projectId),external=entry(path.join(base,'External'));
 const rows=workspaceProjectPlacements(source,destination,[parent,child,external],{version:1});assert.equal(rows.find(row=>row.projectId===external.projectId).destination,legacyWorkspaceProjectDestination(source,destination,external));assert.deepEqual(workspaceProjectPlacements(source,destination,rows,{version:1}),rows);
 const externalChild=entry(path.join(external.root,'Child'),external.projectId);
 rejects([external,{...externalChild,destination:legacyWorkspaceProjectDestination(source,destination,externalChild)}]);
});
test('invalid parent, cycle and undeclared physical ownership fail before placement',()=>{
 const parent=entry(path.join(base,'External Parent')),child=entry(path.join(parent.root,'Child'),parent.projectId);
 rejects([child]);rejects([parent,{...child,root:path.join(base,'Other child')}]);rejects([parent,{...child,parentId:null}]);
 rejects([{...parent,parentId:child.projectId},child]);rejects([parent,{...child,projectId:parent.projectId}]);
});
test('destination collision and unrelated nested placement are rejected',()=>{
 const external=entry(path.join(base,'External Parent')),collision=entry(path.join(source,'External Parent'));
 rejects([external,collision]);
 const unrelated=entry(path.join(source,'External Parent','Unrelated'));rejects([external,unrelated]);
 rejects([entry(path.join(base,'.observanda'))]);rejects([entry(path.join(base,'observanda.json'))]);rejects([entry(source)]);assert.throws(()=>workspaceProjectPlacements(source,path.join(source,'Copy'),[]),{code:'STORAGE_PATH'});
});
