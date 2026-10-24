import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {retainedTable,retainedTablePage,retainedTableBlocks,retainedTableCell} from '../src/retained-tables.js';
import {validRetainedTable} from '../src/web/retained-table-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {PublicationDocumentBuilder,PublicationDocument} from '../src/publication-document.js';
import {retainPublicationTables,publicationTableChunks,verifyRetainedTableEntry} from '../src/publication-retained-tables.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)};
function materials({rows=1205,columns=301,excluded=false}={}){
 const workspace={vault:{id:randomUUID(),key:randomBytes(32)},withCatalogueConnections:fn=>fn(),catalogue:fn=>fn(new ResearchCatalogue(workspace,null))};
 const doc={kind:'dataset',content:{rowCount:rows}},calls=[];
 return {workspace,calls,async read(value){assert.deepEqual(value,ref);return doc;},async retainedSchemaPage(_,options){assert.ok(options.limit<=16);return {items:Array.from({length:Math.min(options.limit,columns-options.offset)},(_,i)=>defaultColumn({label:'Column '+(options.offset+i)})),total:columns};},datasetPageCount(){return Math.ceil(rows/256);},async retainedDatasetPage(_,page,{columns:indices}){assert.ok(indices.length<=16);calls.push({page,indices});return {columnIndices:indices,rows:Array.from({length:Math.min(256,rows-page*256)},(_,i)=>{const ordinal=page*256+i;return {cells:indices.map(column=>ordinal===1204&&column===300?'LAST_EXACT_10000000000000001':'value-'+ordinal+'-'+column),valueKinds:indices.map(column=>ordinal===1&&column===0?'null':'value'),cellPointers:indices.map(column=>'/row/'+ordinal+'/'+column),cellSources:indices.map(()=>[{kind:'authored'}]),...(excluded&&ordinal%3===0?{excluded:'excluded reason'}:{})};})};}};
}
test('pinned queries have no inline row/count/width envelope and bounded windows retain exact provenance',async()=>{
 const m=materials(),selection={columns:'all',offset:0,count:null,includeExcluded:false},table=await retainedTable(m,{ref,selection,version:3});
 assert.equal(validRetainedTable(table),true);assert.ok(JSON.stringify(table).length<200);assert.equal(m.calls.length,0);
 const page=await retainedTablePage(m,{ref,table,offset:1204,columnOffset:296});assert.equal(page.table.rows[0].cells[4],'LAST_EXACT_10000000000000001');assert.equal(page.table.rows[0].pointers[4],'/row/1204/300');assert.equal(page.columnCount,301);assert.equal(page.next,null);assert.deepEqual(page.columnIndices,[296,297,298,299,300]);
 const first=await retainedTablePage(m,{ref,table});assert.equal(first.table.rows[1].presence[0],'null');assert.equal(first.next,16);assert.equal(first.columnNext,8);
 await assert.rejects(retainedTablePage(m,{ref,table,limit:33}),{code:'DATASET_TABLE'});await assert.rejects(retainedTable(m,{ref,selection:{...selection,columns:[301]},version:3}),{code:'DATASET_TABLE'});
 let cells=0,blocks=0,last=false;for await(const block of retainedTableBlocks(m,{ref,table})){assert.ok(block.table.rows.length<=16);assert.ok(block.table.headers.length<=8);cells+=block.table.rows.length*block.table.headers.length;blocks++;last||=block.table.rows.some(row=>row.cells.includes('LAST_EXACT_10000000000000001'));}
 assert.equal(cells,1205*301);assert.equal(last,true);assert.ok(blocks>1000);
});
test('filtered query pages count matching rows and explicit columns retain chosen order',async()=>{
 const m=materials({rows:80,columns:5,excluded:true}),table=await retainedTable(m,{ref,selection:{columns:[4,1],offset:5,count:19,includeExcluded:false},version:3}),first=await retainedTablePage(m,{ref,table}),second=await retainedTablePage(m,{ref,table,offset:first.next});
 assert.deepEqual(first.table.rows[0].cells,['value-8-4','value-8-1']);assert.equal(first.table.rows.length+second.table.rows.length,19);assert.equal(second.next,null);assert.equal(first.table.rows.some(row=>row.exclusion!==null),false);
});
test('native publication capture retains complete table chunks independently of the source and detects missing or substituted query evidence',async()=>{
 const files=new Map(),workspace={async readMetadata(file,limit){const text=files.get(file)??null;if(text!==null)assert.ok(Buffer.byteLength(text)<=limit);return text;},async writeMetadata(file,text){assert.ok(Buffer.byteLength(text)<=65536);files.set(file,text);}},owner={kind:'source',workspaceId:randomUUID(),websiteId:null,jobId:randomUUID(),attemptId:null},builder=new PublicationDocumentBuilder(workspace,{owner,collections:{retainedTables:{indexes:['result']}}});
 const m=materials({rows:1205,columns:9}),originalPage=m.retainedDatasetPage,unicode=String.fromCodePoint(0x1f642).repeat(5000);m.retainedDatasetPage=async(...args)=>{const data=await originalPage(...args);if(args[1]===0&&data.columnIndices.includes(0))data.rows[0].cells[data.columnIndices.indexOf(0)]=unicode;return data;};const table=await retainedTable(m,{ref,selection:{columns:'all',offset:0,count:null,includeExcluded:false},version:3}),statement={id:randomUUID(),source:ref,table},record={id:randomUUID(),results:{statements:[statement]}};
 await retainPublicationTables(builder,m,record,record.id);assert.ok(builder.count('retainedTables')>64);const descriptor=await builder.finish({header:{tableQueries:1}}),reader=await PublicationDocument.open(workspace,descriptor,{owner}),input={native:true,document:reader};
 m.read=()=>{throw Error('Publication must not reopen the dataset');};let size=0,last=false,privateRef=false,astral=0,carry='';for await(const text of publicationTableChunks(input,record.id,statement)){size+=Buffer.byteLength(text);const decoded=carry+text;carry=/[\uD800-\uDBFF]$/.test(decoded)?decoded.slice(-1):'';astral+=[...decoded.slice(0,decoded.length-carry.length)].filter(value=>value===String.fromCodePoint(0x1f642)).length;last||=text.includes('value-1204-8');privateRef||=text.includes(ref.id)||text.includes('/row/');}
 assert.ok(size>262144);assert.equal(astral,5000);assert.equal(carry,'');assert.equal(last,true);assert.equal(privateRef,false);await reader.verify();
 await assert.rejects(async()=>{for await(const part of publicationTableChunks(input,record.id,{...statement,table:{...table,selection:{...table.selection,count:1}}}))void part;},{code:'JOB_DAMAGED'});
 const summaryKey=record.id+'/'+statement.id+'/summary',summary=await reader.get('retainedTables',summaryKey),admitted={...input,document:{get:async(name,key)=>name==='records'&&key===record.id?{id:key}:reader.get(name,key)},record:async()=>record};
 await verifyRetainedTableEntry(admitted,summaryKey,summary);
 await assert.rejects(verifyRetainedTableEntry({...admitted,record:async()=>({...record,results:{statements:[]}})},summaryKey,summary),{code:'JOB_DAMAGED'});
 const orphanId=randomUUID(),orphanKey=record.id+'/'+orphanId+'/0000000000000000';await assert.rejects(verifyRetainedTableEntry(admitted,orphanKey,{recordId:record.id,resultId:orphanId,ordinal:0,text:'orphan'}),{code:'JOB_DAMAGED'});
 const first=await reader.window('retainedTables',{limit:1}),changed=await PublicationDocumentBuilder.open(workspace,descriptor,{owner});await changed.upsert('retainedTables',first.items[0].key,{...first.items[0].value,text:'changed'},{indexes:{result:record.id+'/'+statement.id+'/'}});const tampered=await PublicationDocument.open(workspace,await changed.finish({header:{}}),{owner});await assert.rejects(async()=>{for await(const part of publicationTableChunks({native:true,document:tampered},record.id,statement))void part;},{code:'JOB_DAMAGED'});
});

test('long exact cells have explicit preview boundaries and complete paged access without slicing a numeric source',async()=>{
 const m=materials({rows:1,columns:1}),original=m.retainedDatasetPage,exact='10000000000000001.'+'123456'.repeat(2000);
 m.retainedDatasetPage=async(...args)=>{const data=await original(...args);data.rows[0].cells=[{format:'dataset-cell',version:1,characters:exact.length,sha256:'b'.repeat(64),parts:{}}];return data;};
 m.readDatasetCell=async(value,{offset,limit})=>{assert.equal(value.characters,exact.length);return {text:exact.slice(offset,offset+limit),offset,total:exact.length,next:offset+limit<exact.length?offset+limit:null};};
 const table=await retainedTable(m,{ref,selection:{columns:'all',offset:0,count:null,includeExcluded:false},version:3}),preview=await retainedTablePage(m,{ref,table});
 assert.equal(preview.table.rows[0].cells[0],exact.slice(0,1024));assert.equal(preview.table.rows[0].cellWindows[0].next,1024);let received='',offset=0;
 do{const page=await retainedTableCell(m,{ref,table,rowOffset:0,columnOffset:0,offset});received+=page.value;assert.equal(page.source.selector.column,0);offset=page.next;}while(offset!==null);
 assert.equal(received,exact);await assert.rejects(retainedTableCell(m,{ref,table,rowOffset:1,columnOffset:0}),{code:'DATASET_TABLE'});
});

test('late filtered row ranks and authenticated continuations bound navigation and long-cell page reads',async()=>{
 const m=materials({rows:100005,columns:10,excluded:true}),doc=await m.read(ref),pageSize=256;
 const includedBefore=ordinal=>ordinal-Math.floor((ordinal+2)/3);
 m.datasetRowPosition=async(_,options)=>{
  const ordinal=options.includeExcluded?options.offset:Math.floor(options.offset/2)*3+options.offset%2+1,page=Math.floor(ordinal/pageSize);
  return options.includeExcluded?{page,row:ordinal%pageSize,ordinal,offset:options.offset}:{page,row:0,ordinal:page*pageSize,offset:includedBefore(page*pageSize)};
 };
 const table=await retainedTable(m,{ref,selection:{columns:'all',offset:7,count:16000,includeExcluded:false},version:3});
 let page=await retainedTablePage(m,{ref,table,offset:12000});assert.ok(m.calls.length<=2);assert.equal(page.offset,12000);assert.equal(page.table.rows[0].ordinal,18011);
 const before=page.table.rows.map(row=>row.ordinal);m.calls.length=0;
 const next=await retainedTablePage(m,{ref,table,cursor:page.nextCursor});assert.ok(m.calls.length<=2);assert.equal(next.offset,12016);assert.equal(next.table.rows[0].ordinal,18035);
 m.calls.length=0;const previous=await retainedTablePage(m,{ref,table,cursor:next.previousCursor});assert.ok(m.calls.length<=2);assert.deepEqual(previous.table.rows.map(row=>row.ordinal),before);
 m.calls.length=0;const horizontal=await retainedTablePage(m,{ref,table,cursor:page.cursor,columnOffset:8});assert.ok(m.calls.length<=2);assert.equal(horizontal.offset,page.offset);assert.deepEqual(horizontal.table.rows.map(row=>row.ordinal),before);
 const exact='10000000000000001.'+'1234567890'.repeat(1800),original=m.retainedDatasetPage;
 m.retainedDatasetPage=async(...args)=>{const data=await original(...args);if(args[1]===page.table.rows[0].page)data.rows[page.table.rows[0].row].cells[0]=exact;return data;};
 let text='',offset=0,cursor=page.table.rows[0].cursor;
 do{m.calls.length=0;const cell=await retainedTableCell(m,{ref,table,cursor,rowOffset:12000,columnOffset:0,offset});assert.equal(m.calls.length,1);assert.equal(cell.pointer,'/row/18011/0');text+=cell.value;offset=cell.next;cursor=cell.cursor;}while(offset!==null);assert.equal(text,exact);
 await assert.rejects(retainedTablePage(m,{ref,table,cursor:page.cursor,offset:0}),{code:'DATASET_TABLE'});
 await assert.rejects(retainedTableCell(m,{ref,table,cursor:page.table.rows[0].cursor,rowOffset:12001,columnOffset:0}),{code:'DATASET_TABLE'});
 await assert.rejects(retainedTablePage(m,{ref,table:{...table,selection:{...table.selection,columns:[0]}},cursor:page.cursor}),{code:'DATASET_TABLE'});
 await assert.rejects(retainedTablePage(m,{ref,table:{...table,selection:{...table.selection,count:15000}},cursor:page.cursor}),{code:'DATASET_TABLE'});
 await assert.rejects(retainedTablePage(m,{ref,table:{...table,selection:{...table.selection,offset:8}},cursor:page.cursor}),{code:'DATASET_TABLE'});
 const token=Buffer.from(page.cursor,'base64url');token[20]^=1;await assert.rejects(retainedTablePage(m,{ref,table,cursor:token.toString('base64url')}),{code:'DATASET_TABLE'});
 await assert.rejects(retainedTablePage(materials({rows:100005,columns:10,excluded:true}),{ref,table,cursor:page.cursor}),{code:'DATASET_TABLE'});
 m.read=async()=>doc;await assert.rejects(retainedTablePage(m,{ref:{...ref,revision:'b'.repeat(64)},table,cursor:page.cursor}),{code:'DATASET_TABLE'});
});

test('legacy filtered snapshots scan the first offset only, then page backwards and forwards from exact anchors',async()=>{
 const m=materials({rows:100005,columns:2,excluded:true}),table=await retainedTable(m,{ref,selection:{columns:'all',offset:5,count:19000,includeExcluded:false},version:3});
 const page=await retainedTablePage(m,{ref,table,offset:12000});assert.ok(m.calls.length>60);m.calls.length=0;
 const next=await retainedTablePage(m,{ref,table,cursor:page.nextCursor});assert.ok(m.calls.length<=2);m.calls.length=0;
 const prior=await retainedTablePage(m,{ref,table,cursor:next.previousCursor});assert.ok(m.calls.length<=2);assert.deepEqual(prior.table.rows.map(row=>row.ordinal),page.table.rows.map(row=>row.ordinal));
 const first=await retainedTablePage(m,{ref,table}),back=await retainedTablePage(m,{ref,table,cursor:(await retainedTablePage(m,{ref,table,cursor:first.nextCursor})).previousCursor});assert.equal(back.offset,0);assert.equal(back.previousCursor,null);assert.deepEqual(back.table.rows.map(row=>row.ordinal),first.table.rows.map(row=>row.ordinal));
});

test('backward cursors cross excluded pages and changed page sizes stop at the selection boundary',async()=>{
 const m=materials({rows:1024,columns:1}),original=m.retainedDatasetPage;
 m.retainedDatasetPage=async(...args)=>{const data=await original(...args);if(args[1]===1)for(const row of data.rows)row.excluded='whole page excluded';return data;};
 const table=await retainedTable(m,{ref,selection:{columns:'all',offset:0,count:null,includeExcluded:false},version:3}),page=await retainedTablePage(m,{ref,table,offset:256});assert.equal(page.table.rows[0].ordinal,512);m.calls.length=0;
 const previous=await retainedTablePage(m,{ref,table,cursor:page.previousCursor});assert.equal(m.calls.length,3);assert.equal(previous.offset,240);assert.deepEqual(previous.table.rows.map(row=>row.ordinal),Array.from({length:16},(_,i)=>240+i));
 const next=await retainedTablePage(m,{ref,table,cursor:previous.nextCursor});assert.equal(next.offset,256);assert.equal(next.table.rows[0].ordinal,512);
 const small=await retainedTablePage(m,{ref,table,limit:8}),second=await retainedTablePage(m,{ref,table,cursor:small.nextCursor,limit:8}),back=await retainedTablePage(m,{ref,table,cursor:second.previousCursor,limit:32});assert.equal(back.offset,0);assert.equal(back.table.rows.length,8);assert.equal(back.previousCursor,null);assert.ok(back.cursor);assert.equal(back.next,8);
 const forward=await retainedTablePage(m,{ref,table,cursor:back.nextCursor,limit:32});assert.equal(forward.offset,8);assert.equal(forward.table.rows.length,32);
});

test('legacy inline table reads do not require a native encrypted connection scope',async()=>{
 const column=defaultColumn({label:'Exact'}),m={workspace:{storageKind:async()=>'json',withCatalogueConnections(){assert.fail('Legacy reader entered native scope');}},read:async()=>({content:{}}),datasetColumns:async()=>[column],async *iterateDataset(){yield {cells:['0001.2300'],valueKinds:['number']};}};
 const table=await retainedTable(m,{ref,selection:{columns:[0],offset:0,count:1,includeExcluded:false},version:1});assert.equal(table.rows[0].cells[0],'0001.2300');assert.equal(table.version,1);
});
