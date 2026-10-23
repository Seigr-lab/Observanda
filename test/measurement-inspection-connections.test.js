import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {executeMaterialRequest} from '../src/material-requests.js';
import {AppError} from '../src/errors.js';

test('paged provenance inspection reuses one scoped connection and closes it on success or denied reads',{timeout:90000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inspection-')),book=sampleNotebook(),{workspace,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const materials=new ResearchMaterials(workspace),recordId=book.entries[0].id,columns=Array.from({length:17},(_,i)=>({...defaultColumn({label:'C'+i}),representation:'integer'})),bytes=Buffer.from(JSON.stringify({rows:[Object.fromEntries(columns.map((column,i)=>[column.name,i+1]))]}));
 const upload=await materials.startImport({recordId,name:'observations.json',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id),source=await materials.dataset({recordId,title:'Selected observations',artifact,sourceMapping:{format:'json',rowsPath:'/rows',fields:columns.map(column=>({name:column.name,path:'/'+column.name}))},columns},{signal:t.signal});
 const request=(material,data)=>executeMaterialRequest(workspace,{material},data,{signal:t.signal});let graph=(await request('calculation-graph-create',{recordId,title:'Broad selected provenance',source})).ref;
 const first=(await request('calculation-graph-page',{ref:graph,collection:'bindings'})).items[0],nodes=columns.map((_,column)=>({id:randomUUID(),kind:'column',binding:{id:first.id,position:0},column}));let previous=0;
 const address=position=>({id:nodes[position].id,position});for(let i=1;i<17;i++){nodes.push({id:randomUUID(),kind:'scalar',operation:'add',left:address(previous),right:address(i),condition:null,unit:''});previous=nodes.length-1;}
 const output={id:randomUUID(),name:'Sum',node:address(previous)};
 graph=await workspace.withLock(async()=>{const doc=await materials.read(graph),build=async(kind,items)=>{const writer=materials.sequences.builder(kind,operation=>operation());for(const item of items)await writer.append(item);return writer.finish();};return materials.commit({kind:'analysis',id:doc.id,recordId,title:doc.title,expectedRevision:graph.revision,content:{...doc.content,graphNodesIndex:await build('calculation-nodes',nodes),graphOutputsIndex:await build('calculation-outputs',[output])}});});
 graph=(await request('calculation-graph-change',{ref:graph,collection:'outputs',offset:0,item:{...output,name:'Retained sum'}})).ref;
 const result=await materials.dataset({recordId,title:'Retained sum',calculation:{version:4,graph}},{signal:t.signal}),locator={ref:result,selector:{kind:'cell',page:0,row:0,column:0}};
 let opened=0,closed=0;const open=workspace.openCatalogue.bind(workspace);workspace.openCatalogue=async(...args)=>{const db=await open(...args);opened++;const close=db.close.bind(db);db.close=async()=>{closed++;return close();};return db;};
 for(const offset of [0,16]){const before=opened,detail=await materials.measurements.inspect(locator,{lineageOffset:offset,signal:t.signal});assert.equal(opened-before,1);assert.equal(closed,opened);assert.equal(detail.value.spelling,'153/1');assert.equal(detail.lineage.total,17);assert.ok(Buffer.byteLength(JSON.stringify(detail))<256*1024);assert.equal(detail.lineage.items.length,offset?1:16);for(const item of detail.lineage.items)assert.deepEqual(item.sources[0],{ref:source,selector:{kind:'cell',page:0,row:0,column:item.column}});}
 const original=await materials.measurements.inspect({ref:source,selector:{kind:'cell',page:0,row:0,column:16}});assert.equal(original.original.selector.pointer,'/rows/0/C16');assert.equal(closed,opened);
 const read=materials.read.bind(materials);let reads=0;materials.read=async(...args)=>{if(++reads===2)throw new AppError('ACCESS_DENIED');return read(...args);};
 const before=opened;await assert.rejects(materials.measurements.inspect(locator),{code:'ACCESS_DENIED'});assert.equal(opened-before,1);assert.equal(closed,opened);materials.read=read;
 assert.equal((await materials.measurements.inspect(locator)).value.spelling,'153/1');assert.equal(closed,opened);
});
