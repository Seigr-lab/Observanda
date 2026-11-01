import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectDirectory} from '../src/web/project-directory.js';

test('first-project guidance requires a confirmed empty directory in the current workspace',async()=>{
 const state={book:{projects:[]},page:'workspace',storage:{contextId:'first',researchStorage:'catalogue'}};
 let rows=[],failure=false,calls=0;
 const directory=projectDirectory({state,esc:String,changed:()=>{},api:async(route,input)=>{
  assert.equal(route,'/api/projects/list');assert.equal(input.parentId,null);assert.equal(input.limit,50);calls++;
  if(failure)throw Error('Directory unavailable');
  return {projects:rows,ancestors:[],total:rows.length,revision:String(calls)};
 }});
 assert.equal(directory.confirmedEmpty(),false);
 await directory.refresh();assert.equal(directory.confirmedEmpty(),true);
 failure=true;await directory.refresh();assert.equal(directory.confirmedEmpty(),false);
 failure=false;rows=[{projectId:'owned-project',parentId:null,summary:{title:'Existing work'}}];
 await directory.refresh();assert.equal(directory.confirmedEmpty(),false);assert.deepEqual(state.book.projects,[]);
 state.storage.contextId='second';rows=[];assert.equal(directory.confirmedEmpty(),false);
 await directory.refresh();assert.equal(directory.confirmedEmpty(),true);
 state.book.projects=[{id:'embedded-project'}];assert.equal(directory.confirmedEmpty(),false);
 assert.equal(calls,4);
});

test('document workspaces retain their embedded first-project guidance without a directory read',()=>{
 const state={book:{projects:[]},storage:{researchStorage:'document'}};
 const directory=projectDirectory({state,esc:String,changed:()=>{},api:()=>assert.fail('Document workspace must not read a project directory')});
 assert.equal(directory.confirmedEmpty(),true);
 state.book.projects.push({id:'embedded-project'});assert.equal(directory.confirmedEmpty(),false);
});
