import {moduleMigrationDependencies} from '../src/project-module-ownership.js';
import {timelineCollectionChoices} from '../src/timeline-collection-choices.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {timelineCollectionQuery} from '../src/timeline-collection-query.js';
import {timelineDefaults,timelineQuery,timelineScope} from '../src/web/tools/timeline-model.js';
import {timelineSource,validTimelineSource} from '../src/web/tools/timeline-source.js';
import {validateTimelinePage} from '../src/web/tools/timeline-page.js';
import {validateTool,toolDefinitions} from '../src/modules/tools.js';
import {moduleReferences} from '../src/modules/references.js';
const id=randomUUID;
function fixture(count){
 const workspaceId=id(),recordIds=Array.from({length:count},id),projects=[],owners=[];
 for(let i=0;i<3;i++){
  const namespaceId=id(),projectId=id(),notebookId=id(),records=recordIds.map((id,j)=>({id,notebookId,title:'Observation '+j,occurredOn:j%5?{kind:'month',value:'2026-06',estimated:false}:{kind:'unknown'},status:'completed',tags:['shared']}));
  projects.push({namespaceId,projectId,parentId:null,summary:{title:'Project '+i}});
  const metadata={id:namespaceId,projects:[{id:projectId,title:'Project '+i}],notebooks:[{id:notebookId,title:'Book '+i,projectId}]},snapshots=new Map([['a'.repeat(64),{metadata,records}]]),state={head:'a'.repeat(64)},owner={workspaceId:namespaceId,projectId,labBookId:null};
  const storage={catalogue:fn=>fn({head:async()=>state.head,snapshot:async value=>snapshots.get(value),searchMembers:async function*(snapshot){yield* snapshot.records;},queryDocuments:async function*(values){yield* values;}})};owners.push({storage,owner,state,snapshots});
 }
 const registry={workspaceId,directory:async()=>({revision:'directory',projects})};
 const visit=async(fn,options)=>{for(const entry of owners)if((options.selection.scopeMode==='all'||options.selection.projectIds.includes(entry.owner.projectId))&&options.includeOwner(entry.owner))await fn(entry.storage,entry.owner);};
 const pages=new RecordCollectionPages(),client={},command={workspaceId,query:timelineQuery(timelineDefaults()),limit:17,cursor:null},read=data=>timelineCollectionQuery(pages,client,{...command,...data},{registry,visit});
 return {command,read,owners,pages};
}
test('timeline orders copied IDs across namespaces with immutable forward and backward pages at tenfold growth',async()=>{
 for(const count of [40,400]){
  const f=fixture(count),first=await f.read({}),second=await f.read({cursor:first.nextCursor}),seen=[];let page=first;
  const {state,snapshots}=f.owners[0];state.head='b'.repeat(64);const source=snapshots.get('a'.repeat(64));snapshots.set(state.head,{...source,records:source.records.map(row=>({...row,title:'Changed'}))});
  assert.deepEqual((await f.read({cursor:first.nextCursor})).records,second.records);
  do{validateTimelinePage(page,{...f.command,collection:true,snapshotId:first.snapshotId});assert.equal(page.total,count*3);seen.push(...page.records.map(row=>row.owner.workspaceId+'/'+row.id));if(!page.nextCursor)break;page=await f.read({cursor:page.nextCursor});assert.equal(page.changed,true);}while(true);
  assert.equal(new Set(seen).size,count*3);const previous=await f.read({cursor:page.previousCursor});assert.deepEqual(previous.records.map(row=>row.owner.workspaceId+'/'+row.id),seen.slice(page.offset-17,page.offset));
  await assert.rejects(f.read({cursor:first.nextCursor,query:{...f.command.query,descending:true}}),{code:'RECORD_QUERY_CURSOR'});
  f.owners.pop();await assert.rejects(f.read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});f.pages.clear();
 }
});
test('qualified timeline sources stay scoped and saved filters retain external ownership',async()=>{
 const workspaceId=id(),projectId=id(),notebookId=id(),foreign=id(),source=foreign+'/'+notebookId,book={id:workspaceId,projects:[{id:projectId,parentId:null}],notebooks:[{id:notebookId,projectId}]};
 assert.deepEqual(timelineSource(source,workspaceId),{workspaceId:foreign,id:notebookId});assert.equal(validTimelineSource(source+'/extra'),false);
 assert.equal(timelineScope(book,{...timelineDefaults(),books:[source]}).size,0);assert.equal(timelineScope(book,{...timelineDefaults(),books:[workspaceId+'/'+notebookId]}).size,1);
 const data={name:'Chronology',links:[],engine:1,...timelineDefaults(),books:[source]};validateTool('timeline-view',data);let saved;
 await toolDefinitions.commands['timeline-view.save']({book,get:()=>null,expect(){},put:(type,id,data)=>{saved=data;}},{id:id(),expectedRevision:null,data});assert.deepEqual(saved.books,[source]);
 assert.deepEqual(moduleReferences({type:'timeline-view',data}).links,[{workspaceId:foreign,type:'notebook',id:notebookId}]);
 assert.deepEqual([...moduleMigrationDependencies({type:'timeline-view',data},workspaceId)],[{kind:'external',workspaceId:foreign,type:'notebook',id:notebookId}]);
});
test('timeline client rejects duplicate owner identities, unordered records and original bodies',async()=>{
 const f=fixture(10),page=await f.read({}),options={...f.command,collection:true};assert.equal(validateTimelinePage(page,options),page);
 for(const patch of [{records:[page.records[0],page.records[0],...page.records.slice(2)]},{records:[...page.records].reverse()},{records:page.records.map(row=>({...row,body:'unexpected'}))},{collection:false},{records:page.records.map(row=>({...row,owner:{...row.owner,workspaceId:'invalid'}}))}])assert.throws(()=>validateTimelinePage({...page,...patch},options),/TIMELINE_RESPONSE/);
});

test('timeline source pages remain stable while selections change',async()=>{
 const workspaceId=id(),projects=Array.from({length:60},(_,i)=>({projectId:id(),namespaceId:id(),parentId:null,summary:{title:'Project '+String(i).padStart(2,'0')}})),registry={workspaceId,directory:async()=>({revision:'sources',projects})},pages=new RecordCollectionPages(),client={},command={workspaceId,kind:'projects',search:'',selected:[],limit:25,cursor:null},options={registry,check:async()=>{},visit:()=>{throw Error('Project choices opened a record database');}};
 const first=await timelineCollectionChoices(pages,client,command,options),next=await timelineCollectionChoices(pages,client,{...command,cursor:first.nextCursor,selected:[first.items[0].value]},options);assert.equal(next.offset,25);assert.equal(next.total,60);assert.deepEqual(next.selected,[first.items[0]]);
 const back=await timelineCollectionChoices(pages,client,{...command,cursor:next.previousCursor,selected:[next.items[0].value]},options);assert.deepEqual(back.items,first.items);assert.deepEqual(back.selected,[next.items[0]]);
});
