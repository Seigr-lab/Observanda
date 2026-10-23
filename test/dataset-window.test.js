import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultWindow,windowColumn,windowDisposition,validWindow} from '../src/web/dataset-window-model.js';
import {calculateWindow,graphWindowCell} from '../src/dataset-window-operations.js';
import {DatasetWindowReader,windowSourcePage} from '../src/dataset-window-reader.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {validLineageLeaf} from '../src/calculation-lineage.js';
const column={...defaultColumn({label:'Exact'}),representation:'rational',missing:[{value:'NA',meaning:'Not observed'}]},policy=defaultDatasetResourcePolicy(),node=(operation,window={})=>({id:randomUUID(),kind:'window',binding:{id:randomUUID(),position:0},column:0,operation,window:{...defaultWindow(),start:0,end:1,boundary:'partial',...window}}),cell=value=>({value,kind:'string',excluded:null}),run=(operation,cells,window={},p=policy)=>calculateWindow(node(operation,window),column,{anchor:0,total:cells.length,at:async i=>cells[i]},p);
test('exact reductions preserve offset lexical values and never turn missing or excluded rows into zero',async()=>{
 assert.deepEqual(await run('sum',[cell('1/3'),cell('1/6')]),cellResult('1/2'));
 assert.deepEqual(await run('mean',[cell('1/3'),cell('1/6')]),cellResult('1/4'));
 assert.deepEqual(await run('min',[cell('0002/1'),cell('3/1')]),cellResult('0002/1'));
 assert.deepEqual(await run('max',[cell('2/1'),cell('0003/1')]),cellResult('0003/1'));
 assert.deepEqual(await run('lag',[{value:'',kind:'null'}],{start:-1,end:-1}),{value:'',kind:'null'});
 assert.deepEqual(await run('lead',[{value:'',kind:'absent'}],{start:1,end:1}),{value:'',kind:'absent'});
 assert.deepEqual(await run('sum',[cell('NA'),cell('1/1')]),{value:'',kind:'absent'});
 assert.deepEqual(await run('sum',[cell('NA'),cell('1/1')],{missing:'skip'}),cellResult('1/1'));
 assert.deepEqual(await run('sum',[{...cell('2/1'),excluded:'Outlier'},cell('3/1')],{excluded:'skip'}),cellResult('3/1'));
 assert.deepEqual(await run('sum',[{...cell('2/1'),excluded:'Outlier'},cell('3/1')],{excluded:'include'}),cellResult('5/1'));
 assert.deepEqual(await run('mean',[cell('NA')],{missing:'skip'}),{value:'',kind:'absent'});
 assert.deepEqual(await run('count',[cell('NA')],{missing:'skip'}),cellResult('0'));
 await assert.rejects(run('sum',[cell('NA')],{missing:'error'}),{code:'DATASET_WINDOW_VALUE'});
 assert.deepEqual(windowDisposition({...cell('NA'),excluded:'Excluded'},column,defaultWindow()),{presence:'missing',reason:'excluded',used:false,policy:'propagate'});
});
function cellResult(value){return {value,kind:'string'};}
test('boundary and resource policies are explicit and charge visits even when every row is skipped',async()=>{
 const outside={boundary:true,value:'',kind:'absent',excluded:null};assert.deepEqual(await run('sum',[outside,cell('2/1')],{boundary:'partial'}),cellResult('2/1'));assert.deepEqual(await run('sum',[outside,cell('2/1')],{boundary:'absent'}),{value:'',kind:'absent'});await assert.rejects(run('sum',[outside],{boundary:'error'}),{code:'DATASET_WINDOW_VALUE'});
 const low=structuredClone(policy);low.resources.maxOperations=5;await assert.rejects(run('count',Array.from({length:10},()=>cell('NA')),{missing:'skip'},low),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.equal(validWindow({...defaultWindow(),start:-Number.MAX_SAFE_INTEGER,end:Number.MAX_SAFE_INTEGER},'sum'),false);assert.equal(validWindow({...defaultWindow(),order:'time'},'mean'),false);
 const absolute={...column,quantity:{origin:'measured',conversion:null,calibration:null,unitDefinition:{kind:'absolute'}}};assert.throws(()=>windowColumn(node('mean'),absolute),{code:'DATASET_WINDOW_INVALID'});assert.equal(windowColumn(node('min'),absolute).quantity,absolute.quantity);
});
test('paged source reader reauthorizes operations, bounds its cache and shows skipped provenance without moving row positions',async()=>{
 const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},binding={id:randomUUID(),source,view:'observations',match:null},rows=Array.from({length:129},(_,i)=>({id:'row'+i,order:i+1,excluded:i===63?'Excluded':null,cells:[i===64?'NA':String(i)+'/1'],valueKinds:[i===65?'null':'string']})),doc={content:{datasetFormat:3,rowCount:129,pageIndex:{count:3}}};let reads=0,pages=0,denied=false;
 const materials={read:async()=>{reads++;if(denied)throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});return doc;},datasetPageCount:()=>3,sequences:{item:async(_,p)=>({count:Math.min(64,129-p*64)})},retainedDatasetPage:async(_,p)=>{pages++;return {rows:rows.slice(p*64,p*64+64)};}};
 const reader=new DatasetWindowReader(materials),n={...node('sum',{start:-1,end:1,missing:'skip',excluded:'skip'}),binding:{id:binding.id,position:0}};
 for(let i=0;i<129;i++)await graphWindowCell(materials,n,binding,{kind:'dataset',page:Math.floor(i/64),row:i%64,id:rows[i].id,excluded:rows[i].excluded},column,policy,{windowReader:reader});assert.equal(reads,129);assert.equal(pages,3);assert.ok(reader.pages.size<=3);
 const location={kind:'dataset',page:1,row:0,id:'row64',excluded:null},p=await windowSourcePage(materials,n,binding,location,column);assert.deepEqual(p.items.map(v=>[v.relativeRow,v.reason,v.source.selector.page,v.source.selector.row]),[[-1,'excluded',0,63],[0,'missing',1,0],[1,'null',1,1]]);
 const wide={...n,window:{...n.window,start:-20,end:20}},first=await windowSourcePage(materials,wide,binding,location,column),next=await windowSourcePage(materials,wide,binding,location,column,{offset:first.next});assert.equal(first.items.length,16);assert.equal(next.items[0].relativeRow,-4);assert.equal(next.previous,0);assert.equal(first.total,41);
 denied=true;await assert.rejects(graphWindowCell(materials,n,binding,location,column,policy,{windowReader:reader}),{code:'ACCESS_LOCKED'});
});
test('window lineage binds the immutable node and rejects invented addresses',()=>{
 const leaf={binding:{id:randomUUID(),position:0},column:1,window:{node:{id:randomUUID(),position:3}}};assert.ok(validLineageLeaf(leaf));assert.equal(validLineageLeaf({...leaf,window:{...leaf.window,unchecked:true}}),false);assert.equal(validLineageLeaf({...leaf,relativeRow:-1}),false);
});

test('legacy retained page shapes default value presence and unsafe frame addition refuses',async()=>{
 const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},binding={source},n=node('lag',{start:-1,end:-1}),rows=[{id:'a',cells:['0002/1'],excluded:null},{id:'b',cells:['3/1'],excluded:null}],materials={read:async()=>({content:{datasetFormat:2,rowCount:2}}),datasetPageCount:()=>1,retainedDatasetPage:async()=>({rows})},location={kind:'dataset',page:0,row:1,id:'b',excluded:null};assert.deepEqual(await graphWindowCell(materials,n,binding,location,column,policy),cellResult('0002/1'));await assert.rejects(new DatasetWindowReader(materials).open({...n,operation:'lead',window:{...n.window,start:Number.MAX_SAFE_INTEGER,end:Number.MAX_SAFE_INTEGER}},binding,location),{code:'DATASET_WINDOW_INVALID'});
});
