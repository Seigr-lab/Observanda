import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {publicationSiteDirectory} from '../src/publication-site-directory.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
test('website directory pages preserve owner identities and snapshots without reading records',async()=>{
 const workspaceId=id(),projectId=id(),siteIds=Array.from({length:40},id),owners=Array.from({length:3},(_,i)=>{
  const namespace=id(),book=id(),metadata={id:namespace,title:'Owner '+i,projects:[{id:projectId}],notebooks:[{id:book,title:'Book '+i}],websites:siteIds.map((id,j)=>({id,name:'Site '+String(j).padStart(2,'0'),projectId}))};
  const owner={workspaceId:namespace,projectId,labBookId:i===2?book:null},state={head:'a'.repeat(64)},snapshots=new Map([[state.head,{metadata}]]);
  const storage={catalogue:fn=>fn({head:async()=>state.head,snapshot:async head=>snapshots.get(head),record:()=>{throw Error('Directory read an original');}})};return {owner,state,snapshots,metadata,storage};
 }),pages=new RecordCollectionPages(),client={},command={workspaceId,projectId:null,search:'',cursor:null,limit:25},visit=async fn=>{for(const row of owners)await fn(row.storage,row.owner,null);},read=patch=>publicationSiteDirectory(pages,client,{...command,...patch},{visit});
 const first=await read({}),second=await read({cursor:first.nextCursor});assert.equal(first.total,123);
 const source=owners[0];source.state.head='b'.repeat(64);source.snapshots.set(source.state.head,{metadata:{...source.metadata,websites:[]}});
 assert.deepEqual((await read({cursor:first.nextCursor})).items,second.items);
 const all=[];let page=first;do{all.push(...page.items);if(!page.nextCursor)break;page=await read({cursor:page.nextCursor});}while(true);
 assert.equal(new Set(all.map(row=>row.key)).size,123);assert.deepEqual((await read({cursor:page.previousCursor})).items,all.slice(page.offset-25,page.offset));
 assert.equal((await read({search:'Book 2'})).total,41);
 await assert.rejects(read({cursor:first.nextCursor,search:'Changed'}),{code:'RECORD_QUERY_CURSOR'});
 owners.pop();await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(read({limit:26}),{code:'INVALID'});pages.clear();
});
test('website directory selected project excludes unrelated and default websites',async()=>{
 const workspaceId=id(),projectId=id(),child=id(),other=id(),metadata={id:workspaceId,title:'Workspace',projects:[{id:projectId},{id:child,parentId:projectId},{id:other}],notebooks:[],websites:[{id:id(),name:'Selected',projectId},{id:id(),name:'Child',projectId:child},{id:id(),name:'Other',projectId:other}]},pages=new RecordCollectionPages();
 const result=await publicationSiteDirectory(pages,{}, {workspaceId,projectId,search:'',cursor:null,limit:25},{visit:fn=>fn({catalogue:cb=>cb({head:async()=>'a'.repeat(64),snapshot:async()=>({metadata})})},{workspaceId,projectId:null,labBookId:null},projectId)});
 assert.deepEqual(result.items.map(site=>site.name),['Child','Selected']);pages.clear();
});
