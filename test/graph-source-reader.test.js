import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {GraphCalculations} from '../src/calculation-graph-evaluation.js';
import {verifyRetainedCalculation} from '../src/dataset-calculations.js';
import {GraphSourceReader} from '../src/graph-source-reader.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {projectDatasetRows} from '../src/dataset-storage.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},binding={source:ref},location=(row=0,page=0)=>({kind:'dataset',page,row,id:'row-'+page+'-'+row,excluded:null});

test('graph source reader authenticates each operation and reuses only one metadata page while selected cells stay lazy',async()=>{
 const stored=new Map(),sequences=new MaterialSequence({readMetadata:async name=>stored.get(name)??null,writeMetadata:async(name,text)=>stored.set(name,text)}),rows=[];
 const long=await retainDatasetCell({sequences},{kind:'string',value:'0'.repeat(9000)+'12'},fn=>fn());
 for(let row=0;row<18;row++){const cells=sequences.builder('cells',fn=>fn());for(let col=0;col<18;col++)await cells.append(row===9&&col===17?long:{kind:row===10?'null':'string',value:row===10?'':String(row*18+col),...(col===17?{computation:null}:{})});rows.push({id:'row-0-'+row,order:row+1,excluded:row===9?'Authored exclusion':null,cellIndex:await cells.finish()});}
 const doc={content:{datasetFormat:3,schemaIndex:{count:18}}};let authorizations=0,pages=0;const projected=[],originalPage=sequences.page.bind(sequences);sequences.page=async(descriptor,options)=>{if(descriptor.kind==='cells')projected.push(descriptor.root.hash);return originalPage(descriptor,options);};
 const materials={sequences,read:async selected=>{assert.deepEqual(selected,ref);authorizations++;return doc;},retainedDatasetPage:async(selected,page,options)=>{assert.equal(selected,doc);assert.equal(page,0);assert.deepEqual(options,{metadataOnly:true});pages++;return {rows};}},reader=new GraphSourceReader(materials);
 for(const at of [9,10,9]){const selected=await reader.read(binding,location(at));assert.equal(projected.length,authorizations-1);assert.equal(selected.row,rows[at]);const result=(await projectDatasetRows(materials,selected.doc,[selected.row],[17])).rows[0];assert.equal(result.id,rows[at].id);assert.equal(result.excluded,rows[at].excluded);if(at===9)assert.deepEqual(result.cells[0],long.value);else{assert.equal(result.valueKinds[0],'null');assert.equal(result.cellComputations[0],null);}}
 assert.equal(authorizations,3);assert.equal(pages,1);assert.deepEqual(projected,[rows[9].cellIndex.root.hash,rows[10].cellIndex.root.hash,rows[9].cellIndex.root.hash]);
});

test('graph source metadata cache keys the complete pinned reference and page, retaining only the most recent page',async()=>{
 const calls=[],materials={read:async source=>({source}),retainedDatasetPage:async(doc,page)=>{calls.push([doc.source,page]);return {rows:[{id:'row-'+page+'-0',value:doc.source.revision}]};}},reader=new GraphSourceReader(materials),changed={...ref,revision:'b'.repeat(64)},addressed={...changed,workspaceId:randomUUID()};
 await reader.read(binding,location());await reader.read(binding,location());await reader.read({source:changed},location());await reader.read({source:addressed},location());await reader.read({source:addressed},location(0,1));await reader.read({source:addressed},location());
 assert.deepEqual(calls,[[ref,0],[changed,0],[addressed,0],[addressed,1],[addressed,0]]);
});

test('cached graph rows never bypass current authorization, exact row identity, malformed page refusal or cancellation',async()=>{
 let denied=false,reads=0,pages=0,malformed=false;const failure=new Error('Access revoked'),materials={read:async()=>{reads++;if(denied)throw failure;return {};},retainedDatasetPage:async()=>{pages++;return malformed?{rows:null}:{rows:[{id:'row-0-0',excluded:null}]};}},reader=new GraphSourceReader(materials);
 await reader.read(binding,location());denied=true;await assert.rejects(reader.read(binding,location()),error=>error===failure);assert.equal(reads,2);assert.equal(pages,1);denied=false;
 await assert.rejects(reader.read(binding,{...location(),id:'wrong'}),{code:'MATERIAL_MISSING'});await assert.rejects(reader.read(binding,location(1)),{code:'MATERIAL_MISSING'});await assert.rejects(reader.read(binding,{...location(),page:-1}),{code:'MATERIAL_MISSING'});
 malformed=true;await assert.rejects(reader.read(binding,location(0,1)),{code:'MATERIAL_MISSING'});malformed=false;await assert.rejects(reader.read(binding,location(0,1)),{code:'MATERIAL_MISSING'});assert.equal(pages,3);
 const controller=new AbortController();controller.abort();const before=reads;await assert.rejects(reader.read(binding,location(),{signal:controller.signal}),{name:'AbortError'});assert.equal(reads,before);
 const during=new AbortController();materials.retainedDatasetPage=async()=>{during.abort();return {rows:[{id:'row-2-0'}]};};await assert.rejects(reader.read(binding,location(0,2),{signal:during.signal}),{name:'AbortError'});
});


test('the actual graph engine projects only requested retained cells and reuses its authenticated metadata page',async()=>{
 const stored=new Map(),sequences=new MaterialSequence({readMetadata:async name=>stored.get(name)??null,writeMetadata:async(name,text)=>stored.set(name,text)}),rows=[];
 for(let row=0;row<4;row++){const cells=sequences.builder('cells',fn=>fn());for(let column=0;column<18;column++)await cells.append({kind:row===2?'absent':'string',value:row===2?'':String(row*18+column),computation:null});rows.push({id:'row-0-'+row,excluded:row===3?'Retained exclusion':null,cellIndex:await cells.finish()});}
 const doc={content:{datasetFormat:3,schemaIndex:{count:18}}};let auth=0,pages=0,denied=false;const selected=[],original=sequences.page.bind(sequences);sequences.page=async(value,options)=>{if(value.kind==='cells')selected.push(value.root.hash);return original(value,options);};const materials={workspace:{},sequences,read:async()=>{auth++;if(denied)throw new Error('denied');return doc;},retainedDatasetPage:async(_,page,options)=>{pages++;assert.equal(page,0);assert.deepEqual(options,{metadataOnly:true});return {rows};}},engine=new GraphCalculations(materials),options={sourceReader:new GraphSourceReader(materials)};
 for(let row=0;row<4;row++)assert.deepEqual(await engine.sourceCell(binding,location(row),17,options),{kind:row===2?'absent':'string',value:row===2?'':String(row*18+17),computation:null});
 assert.equal(auth,4);assert.equal(pages,1);assert.deepEqual(selected,rows.map(row=>row.cellIndex.root.hash));denied=true;await assert.rejects(engine.sourceCell(binding,location(),17,options),/denied/);assert.equal(auth,5);assert.equal(pages,1);
});

test('historical inline graph source rows keep requested-column and explicit null/computation semantics',async()=>{
 let reads=0,pages=0;const doc={content:{datasetFormat:2,columns:[{},{},{}]}},rows=[{id:'row-0-0',cells:['left','selected',''],valueKinds:['string','string','null'],cellComputations:[undefined,null,undefined]}],materials={workspace:{},read:async()=>{reads++;return doc;},retainedDatasetPage:async(_,page,options)=>{pages++;assert.deepEqual(options,{metadataOnly:true});return {rows};}},engine=new GraphCalculations(materials);
 assert.deepEqual(await engine.sourceCell(binding,location(),1),{kind:'string',value:'selected',computation:null});assert.deepEqual(await engine.sourceCell(binding,location(),2),{kind:'null',value:''});assert.equal(reads,2);assert.equal(pages,2);await assert.rejects(engine.sourceCell(binding,location(),3),{code:'INVALID'});
});

test('retained calculation verification honors cancellation before reading graph or source state',async()=>{
 const controller=new AbortController();controller.abort(new Error('caller cancelled'));await assert.rejects(verifyRetainedCalculation({read(){assert.fail('Cancelled verification must not read sources');}},{content:{calculation:{version:17,graph:ref}}},{signal:controller.signal}),error=>error===controller.signal.reason);
});


test('each graph row execution owns its page reader, and standalone inspections reauthenticate page contents',async()=>{
 const files=new Map(),workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,value)=>files.set(key,value)},sequences=new MaterialSequence(workspace),sequence=async(kind,items)=>{const b=sequences.builder(kind,fn=>fn());for(const item of items)await b.append(item);return b.finish();},sourceRows=[];
 for(let i=0;i<4;i++)sourceRows.push({id:'row-0-'+i,order:i+1,excluded:null,cellIndex:await sequence('cells',[{kind:'string',value:'unused'},{kind:'string',value:String(i)}])});
 const graphRef={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},input={id:randomUUID(),source:ref,view:'observations',match:null},node={id:randomUUID(),kind:'column',binding:{id:input.id,position:0},column:1},column={...defaultColumn({label:'Number'}),representation:'integer'},source={content:{datasetFormat:3,schemaIndex:{count:2},columns:[defaultColumn({label:'Unused'}),column]}},graph={...graphRef,content:{tool:'Observanda calculation graph',graphVersion:1,graphBindingsIndex:await sequence('calculation-bindings',[input]),graphNodesIndex:await sequence('calculation-nodes',[node]),graphOutputsIndex:await sequence('calculation-outputs',[{id:randomUUID(),name:'Selected',node:{id:node.id,position:0}}]),where:null,selectionReason:''}};
 let pageReads=0,allowed=true;const materials={workspace,sequences,read:async selected=>{if(!allowed)throw new Error('revoked');return selected.id===ref.id?source:graph;},checkReference:async()=>{},datasetColumn:async(doc,index)=>doc.content.columns[index],datasetPageCount:()=>1,retainedSchemaPage:async(doc,{offset=0,limit=16})=>({items:doc.content.columns.slice(offset,offset+limit),total:2}),retainedDatasetPage:async(doc,page,options)=>{assert.equal(doc,source);assert.equal(page,0);assert.deepEqual(options,{metadataOnly:true});pageReads++;return {rows:structuredClone(sourceRows)};}};
 const key='readerScope_'+randomUUID().replaceAll('-','');globalThis[key]=create=>{const values=new Map(),work={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),remove:async key=>values.delete(key),has:async key=>values.has(key),add:async(key,value=true)=>{if(values.has(key))return false;values.set(key,structuredClone(value));return true;}};return create(work);};
 const hooks=registerHooks({resolve(specifier,context,next){return specifier==='./scratch-iterator.js'&&context.parentURL?.includes('reader-scope=')?{url:'reader-scope:'+key,shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='reader-scope:'+key?{format:'module',shortCircuit:true,source:'export const scratchIterator=create=>globalThis['+JSON.stringify(key)+'](create);'}:next(url,context);}});let Engine;try{({GraphCalculations:Engine}=await import('../src/calculation-graph-evaluation.js?reader-scope='+key));}finally{hooks.deregister();}
 try{const engine=new Engine(materials),run=async()=>{const cells=[];for await(const row of engine.rows({calculation:{version:4,graph:graphRef}},graph,{verify:true})){if(row.columnCount!==undefined)continue;for await(const cell of row.cells())cells.push(cell.value);}return cells;};assert.deepEqual(await run(),['0','1','2','3']);assert.equal(pageReads,2,'one location enumeration and one cached source page');assert.deepEqual(await run(),['0','1','2','3']);assert.equal(pageReads,4,'a separate execution starts with a fresh reader');
  assert.equal((await engine.sourceCell(binding,location(1),1)).value,'1');sourceRows[1].cellIndex.root.hash='f'.repeat(64);await assert.rejects(engine.sourceCell(binding,location(1),1));allowed=false;await assert.rejects(run(),/revoked/);
 }finally{delete globalThis[key];}
});
