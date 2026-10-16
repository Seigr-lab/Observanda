import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankedRangePage} from '../src/ranked-range-page.js';
import {projectCollectionScope} from '../src/project-collection-scope.js';
const order=(a,b)=>a.id-b.id;
const page=(offset=0,after=null,backward=false)=>{const value=rankedRangePage({offset,after,backward,limit:4,order});for(const [id,count] of [[3,2],[1,1000000],[2,2]])value.add({id},count);return value.finish();};
test('range paging counts large member collections and reverses exact item boundaries',()=>{
 assert.equal(page().total,1000004);assert.deepEqual(page().items,[0,1,2,3].map(index=>({id:1,index})));
 const next=page(1000001,{id:2,index:0});assert.deepEqual(next.items,[{id:2,index:1},{id:3,index:0},{id:3,index:1}]);
 assert.deepEqual(page(1000001,{id:2,index:1},true).items,[{id:2,index:0},{id:1,index:999999},{id:1,index:999998},{id:1,index:999997}]);
 assert.throws(()=>page(10,{id:1,index:5}),{code:'RECORD_QUERY_CURSOR'});
});
test('collection scopes preserve descendants, workspace exclusions and missing selections',()=>{
 const projects=[{projectId:'a',parentId:null},{projectId:'b',parentId:'a'},{projectId:'c',parentId:null}],selection={scopeMode:'selected',projectIds:['a'],includeWorkspace:false,includeDescendants:true,notebookMode:'selected',notebookIds:['book']};
 let result=projectCollectionScope(projects,{selection});assert.deepEqual([...result.projectIds],['a','b']);assert.deepEqual([...result.notebookIds],['book']);
 result=projectCollectionScope(projects,{selection:{...selection,includeDescendants:false,includeWorkspace:true}});assert.deepEqual([...result.projectIds],['a',null]);
 assert.throws(()=>projectCollectionScope(projects,{scope:'a',selection:{...selection,projectIds:['c']}}),{code:'RECORD_VIEW_SCOPE'});
 assert.throws(()=>projectCollectionScope(projects,{selection:{...selection,projectIds:['missing']}}),{code:'RECORD_VIEW_SCOPE'});
});
