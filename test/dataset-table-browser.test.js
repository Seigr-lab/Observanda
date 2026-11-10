import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {emptyTableQuery} from '../src/web/dataset-table-query.js';
import {browseDatasetTable} from '../src/dataset-table-browser.js';
import {searchDatasetSchema} from '../src/dataset-table-schema.js';
import {tableViewRequest} from '../src/dataset-table-views.js';
import {randomUUID} from 'node:crypto';
import {projectSourceEvidenceOwner} from '../src/project-source-evidence-owner.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {nativeResources} from '../src/native-resource-budget.js';

test('table filters and sorts preserve exact source identities, including duplicate rationals and excluded observations',async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-table-query-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{await clearVault(f.vault);assert.equal(path.dirname(directory),parent);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 const bytes=Buffer.from('Reading,Response,Condition\n9007199254740993,1/10,Withheld\n9007199254740994,1/3,Normal\n9007199254740992,2/20,Check\n');
 const u=await m.startImport({recordId,name:'test.csv',size:bytes.length});await m.appendImport(u.id,0,[bytes]);const artifact=await m.finishImport(u.id);
 const values=await m.dataset({recordId,artifact,title:'Recorded values',columns:[{...defaultColumn({label:'Reading'}),representation:'integer'},{...defaultColumn({label:'Response'}),representation:'rational'},{...defaultColumn({label:'Condition'}),missing:[{value:'Withheld',meaning:'Observation unavailable'}]}],exclusions:{[artifact.id+':4']:'Control observation'}});
 const ref={...values,workspaceId:book.id},query=emptyTableQuery(),options={signal:t.signal};
 const run=(query,offset=0)=>browseDatasetTable(m,{ref,query,offset,limit:2,columns:[1,0]},options);
 const lookup=await searchDatasetSchema(m,{ref,text:'PONSE',offset:0,limit:4},options);
 assert.deepEqual(lookup.items.map(item=>[item.position,item.name]),[[1,'Response']]);
 assert.deepEqual((await run(query,2)).rows.map(row=>[row.id,row.page,row.index,row.ordinal]),[[artifact.id+':4',0,2,2]]);
 const criteria={...query,filters:[{column:1,test:'equal',value:'.1'}],sort:{column:0,direction:'ascending'}};
 const filtered=await run(criteria);
 assert.deepEqual(filtered.rows.map(row=>[row.ordinal,row.cells[0],row.cells[1],row.excluded]),[[2,'2/20','9007199254740992','Control observation'],[0,'1/10','9007199254740993',null]]);
 assert.equal((await run({...criteria,inclusion:'included'})).total,1);
 assert.deepEqual((await run({...query,filters:[{column:2,test:'different',value:'Normal'}]})).rows.map(r=>r.ordinal),[2]);
 assert.equal((await run({...query,filters:[{column:2,test:'contains',value:'With'}]})).total,0);
 assert.deepEqual((await run({...query,filters:[{column:2,test:'missing'}]})).rows.map(r=>r.ordinal),[0]);
 assert.deepEqual((await run({...query,sort:{column:1,direction:'ascending'}})).rows.map(r=>r.ordinal),[0,2]);
 assert.deepEqual((await run({...query,id:artifact.id+':3'})).rows.map(r=>r.ordinal),[1]);
 assert.equal((await m.current(ref.id)).revision,ref.revision);
 const stop=new AbortController();stop.abort();
 await assert.rejects(browseDatasetTable(m,{ref,query:criteria,offset:0,limit:1,columns:[0]},{signal:stop.signal}),{name:'AbortError'});

 const id=randomUUID(),settings={query:criteria,pinned:[1],hidden:[],columnOffset:1},name='Qualified observations';
 const view=await tableViewRequest(m,'table-view-save',{ref,id,previous:null,name,settings},options);
 await m.workspace.catalogue(async store=>{
  const owner=projectSourceEvidenceOwner(store,ownerId=>({recordId:ownerId}));
  const key='metadata:.observanda/materials/table-views/'+recordId+'/'+ref.id+'/'+ref.revision+'/'+id+'.json';
  assert.deepEqual(await owner(key),{recordId});
 });
 const listed=await tableViewRequest(m,'table-view-list',{ref,after:null},options);
 assert.deepEqual(listed.items,[{id,name,settings,revision:view.revision}]);
 await assert.rejects(tableViewRequest(m,'table-view-save',{ref,id,previous:null,name,settings},options),{code:'CONFLICT'});
 const changed=await tableViewRequest(m,'table-view-save',{ref,id,previous:view.revision,name:'Controls',settings},options);
 await assert.rejects(tableViewRequest(m,'table-view-remove',{ref,id,previous:view.revision},options),{code:'CONFLICT'});
 await tableViewRequest(m,'table-view-remove',{ref,id,previous:changed.revision},options);
 assert.deepEqual((await tableViewRequest(m,'table-view-list',{ref,after:null},options)).items,[]);
 assert.equal((await m.current(ref.id)).revision,ref.revision);
});

test('sorting complete text values uses the first differing code unit beyond a native part and an external sort run',async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-long-table-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{await clearVault(f.vault);assert.equal(path.dirname(directory),parent);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id,prefix='x'.repeat(70000);
 const middle=Array.from({length:132},(_,i)=>'entry '+i);
 const words=[prefix+'b',...middle,prefix+'a',prefix,prefix+'a'];
 const bytes=Buffer.from(['Spelling',...words].join('\n'));
 const u=await m.startImport({recordId,name:'spelling.csv',size:bytes.length});await m.appendImport(u.id,0,[bytes]);const artifact=await m.finishImport(u.id);
 const values=await m.dataset({recordId,artifact,title:'Labels and notes'});
 const ref={...values,workspaceId:book.id},q=emptyTableQuery(),options={signal:t.signal};
 const run=(query,offset=0)=>browseDatasetTable(m,{ref,query,offset,limit:4,columns:[0]},options);
 assert.deepEqual((await run({...q,sort:{column:0,direction:'ascending'}},132)).rows.map(r=>r.ordinal),[134,133,135,0]);
 assert.deepEqual((await run({...q,sort:{column:0,direction:'descending'}})).rows.map(r=>r.ordinal),[0,133,135,134]);
 assert.equal((await run({...q,filters:[{column:0,test:'greater',value:'x'.repeat(512)}]})).total,4);
 assert.equal((await run({...q,filters:[{column:0,test:'contains',value:'xb'}]})).total,1);
 const controller=new AbortController(),previous=m.retainedDatasetPage,initial=pinnedQueryResults.stats(),buffers=nativeResources.stats().buffers;
 let pages=0;
 m.retainedDatasetPage=async function(...args){
  const page=await previous.apply(this,args);
  if(++pages===3)controller.abort();
  return page;
 };
 try{
  const filtered={...q,filters:[{column:0,test:'present'}],sort:{column:0,direction:'ascending'}};
  await assert.rejects(browseDatasetTable(m,{ref,query:filtered,offset:0,limit:1,columns:[0]},{signal:controller.signal}),{name:'AbortError'});
  assert.equal(pages,3);
  assert.deepEqual(pinnedQueryResults.stats(),initial);
  assert.equal(nativeResources.stats().buffers,buffers);
 }finally{m.retainedDatasetPage=previous;}
});
