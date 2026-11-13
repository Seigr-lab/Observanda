import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertProjectRoot,assertProjectInsideWorkspace,projectInsideWorkspace} from '../src/project-root-boundaries.js';

const workspace=path.resolve('fixture','Research Workspace 1');
const entry=(root,parentId=null)=>({projectId:randomUUID(),root,parentId});

test('every project root lies strictly inside its workspace folder',()=>{
 const inside=path.join(workspace,'Field Project 1');
 assert.equal(projectInsideWorkspace(workspace,inside),true);
 for(const root of [workspace,path.dirname(workspace),path.resolve('fixture','Other Project'),path.resolve('elsewhere','Research Workspace 1','Field Project 1'),path.join(workspace,'..','Sibling Project')]){
  assert.equal(projectInsideWorkspace(workspace,path.resolve(root)),false,root);
 }
 assert.equal(projectInsideWorkspace(workspace,undefined),false);
 assertProjectInsideWorkspace(workspace,inside);
 assert.throws(()=>assertProjectInsideWorkspace(workspace,path.resolve('fixture','Other Project')),{code:'PROJECT_OUTSIDE_WORKSPACE'});
});

test('project roots outside the workspace are refused for creation, opening and placement',()=>{
 const outside=path.resolve('fixture','Other Project'),parent=entry(path.join(workspace,'Parent Project'));
 assertProjectRoot(workspace,path.join(workspace,'New Project'),[],{parentId:null});
 assertProjectRoot(workspace,path.join(parent.root,'Child Project'),[parent],{parentId:parent.projectId});
 assert.throws(()=>assertProjectRoot(workspace,outside,[]),{code:'PROJECT_OUTSIDE_WORKSPACE'});
 assert.throws(()=>assertProjectRoot(workspace,outside,[],{parentId:null}),{code:'PROJECT_OUTSIDE_WORKSPACE'});
 const registered=entry(outside);assert.throws(()=>assertProjectRoot(workspace,outside,[registered],{existing:true}),{code:'PROJECT_OUTSIDE_WORKSPACE'});
 // The workspace folder itself, its parents and its internals stay refused as before.
 for(const root of [workspace,path.dirname(workspace)])assert.throws(()=>assertProjectRoot(workspace,root,[]),{code:'STORAGE_PATH'});
 assert.throws(()=>assertProjectRoot(workspace,path.join(workspace,'.observanda','Project'),[]),{code:'STORAGE_PATH'});
 assert.throws(()=>assertProjectRoot(workspace,path.join(workspace,'Elsewhere','Project'),[],{parentId:null}),{code:'STORAGE_PATH'});
});

test('a copy or backup destination outside the workspace keeps only its overlap checks',()=>{
 const destination=path.resolve('fixture','Backups','Field Project 1'),registered=entry(path.join(workspace,'Field Project 1'));
 assertProjectRoot(workspace,destination,[registered],{transfer:true});
 assert.throws(()=>assertProjectRoot(workspace,path.dirname(workspace),[],{transfer:true}),{code:'STORAGE_PATH'});
 const overlapping=entry(path.resolve('fixture','Backups'));
 assert.throws(()=>assertProjectRoot(workspace,destination,[overlapping],{transfer:true}),{code:'STORAGE_PATH'});
});
