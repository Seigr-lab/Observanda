import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {verifyPlotProjection} from '../src/dataset-plot-provenance.js';
import {plotNumericalMetadata} from '../src/plot-resource-policy.js';
import {CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {createFigure} from '../src/web/figure-model.js';

// Replace only the encrypted scratch transport; exercise the real plot producer,
// external sorter, retained document writer and authenticated document reader.
const moduleURL=new URL('../src/retained-figure-plot.js?point-batches-test',import.meta.url).href,key='pointBatchWork_'+randomUUID().replaceAll('-','');
let currentWork;
globalThis[key]=operation=>operation(currentWork);
const hooks=registerHooks({resolve(specifier,context,next){return context.parentURL===moduleURL&&specifier==='./scratch-work.js'?{url:'point-batch:scratch',shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='point-batch:scratch'?{format:'module',shortCircuit:true,source:'export const withScratch=operation=>globalThis['+JSON.stringify(key)+'](operation);'}:next(url,context);}});
let prepareRetainedPlot;try{({prepareRetainedPlot}=await import(moduleURL));}finally{hooks.deregister();}
after(()=>{delete globalThis[key];});

function fixture(rows,{mapping={},policy,onBatch,columnComputations=[],rowMetadata=[]}={}){
 const files=new Map(),scratch=new Map(),batches=[],workspace={readMetadata:async name=>files.get(name)??null,writeMetadata:async(name,text)=>{files.set(name,text);}},sequences=new MaterialSequence(workspace),pages=Array.from({length:Math.ceil(rows.length/41)},(_,i)=>({rows:rows.slice(i*41,(i+1)*41).map((cells,row)=>({cells,...rowMetadata[i*41+row]}))}));
 const columns=rows[0].map((_,i)=>({...defaultColumn({label:'Column '+i}),representation:'decimal',...(columnComputations[i]?{computation:columnComputations[i]}:{}),...(policy?{resourcePolicy:policy}:{})})),indices=columns.map((_,i)=>i*3+4),selection={columns,indices,mapping:{x:0,xKind:'number',group:null,values:[{column:1,error:null}],kind:'scatter',operation:'raw',order:'source',...(policy?{resourcePolicy:policy}:{}),...mapping}};
 const work={async get(id){assert.ok(!id.startsWith('point:'),'point reads must use the bounded batch contract');return structuredClone(scratch.get(id));},async getMany(ids){assert.ok(ids.length>0&&ids.length<=32);assert.equal(new Set(ids).size,ids.length);const values=new Map([...ids].reverse().filter(id=>scratch.has(id)).map(id=>[id,structuredClone(scratch.get(id))]));if(ids[0].startsWith('point:')){batches.push([...ids]);await onBatch?.(values,batches);}return values;},async put(id,value){scratch.set(id,structuredClone(value));},async add(id){if(scratch.has(id))return false;scratch.set(id,true);return true;},async removeMany(ids){for(const id of ids)scratch.delete(id);}};
 let sourceReads=0;const materials={workspace,sequences,datasetPageCount:()=>pages.length,readSnapshot:fn=>fn(),retainedDatasetPage:async(doc,page,selected)=>{sourceReads++;assert.deepEqual(selected.columns,indices);return pages[page];}};
 return {materials,batches,selection,pages,sourceReads:()=>sourceReads,async run(options={}){currentWork=work;const result=await prepareRetainedPlot(materials,{content:{rowCount:rows.length}},{dataset:{kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},base:createFigure()},selection,{write:fn=>fn(),...options}),reader=await new RetainedFigureDocuments(workspace,{readOnly:true}).open(result.figure),points=[];for(let at=0;at<result.figure.document.counts.points;at++)points.push((await reader.rawPoint({offset:at})).value);return {result,reader,points};}};
}
const source=at=>({page:Math.floor(at/41),row:at%41});
function assertBatches(f,count,series=1){assert.equal(f.batches.length,Math.ceil(count/32)*series);assert.deepEqual(f.batches.flat(),Array.from({length:series},(_,s)=>Array.from({length:count},(_,at)=>'point:'+s+':'+at)).flat());}

test('source and categorical traversal retain every series point across unordered scratch batches',async()=>{
 for(const category of [false,true]){
  const rows=Array.from({length:65},(_,i)=>[category?'C'+(i%7):String(i%7),i===33?'':String(i),String(100+i)]),f=fixture(rows,{mapping:{xKind:category?'category':'number',kind:category?'bar':'scatter',order:category?'ascending':'source',values:[{column:1,error:null},{column:2,error:null}]}}),{points,result}=await f.run();
  assertBatches(f,65,2);assert.equal(result.figure.document.counts.points,130);
  for(let s=0;s<2;s++)for(let i=0;i<65;i++){const p=points[s*65+i];assert.equal(p.x,category?rows[i][0]:i%7);assert.equal(p.y,s?100+i:i===33?null:i);assert.deepEqual(p.source.source,source(i));assert.equal(p.source.column,s?10:7);}
 }
});

test('ascending numeric and date traversal preserve stable ties across sorter runs and batch tails',async()=>{
 for(const date of [false,true]){
  const rows=Array.from({length:161},(_,i)=>[date?'2026-01-'+String(i%7+1).padStart(2,'0'):String(i%7),String(i)]),f=fixture(rows,{mapping:{xKind:date?'date':'number',order:'ascending'}}),{points}=await f.run(),order=Array.from({length:161},(_,i)=>i).sort((a,b)=>a%7-b%7||a-b);
  assertBatches(f,161);assert.deepEqual(points.map(p=>p.y),order);assert.deepEqual(points.map(p=>p.source.source),order.map(source));assert.deepEqual(points.map(p=>p.x),order.map(i=>date?rows[i][0]:i%7));
 }
});

test('reduced point batches preserve complete group membership and exact reductions',async()=>{
 const rows=Array.from({length:130},(_,i)=>[String(64-i%65),String(i)]),f=fixture(rows,{mapping:{operation:'sum',order:'ascending'}}),{points,result}=await f.run();assertBatches(f,65);assert.equal(result.plotMembersIndex.count,130);
 for(let i=0;i<65;i++){const p=points[i],first=64-i;assert.equal(p.x,i);assert.equal(p.y,first*2+65);assert.equal(p.source.members.count,2);assert.deepEqual((await f.materials.sequences.page(result.plotMembersIndex,{offset:p.source.members.offset,limit:2})).items,[source(first),source(first+65)]);}
});

test('policy-owned long exact coordinates and receipts remain complete across batch and sorter pages',async()=>{
 const policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxOperations:1000000,maxMilliseconds:30000});const origin='1'+'0'.repeat(9000),base=BigInt(origin),q=spelling=>({spelling,representation:'decimal',radix:10}),rows=Array.from({length:33},(_,i)=>[String(base+BigInt(i%3)),String(i)]),projection={version:2,resourcePolicy:policy,x:{origin:q(origin),scale:q('1')}},f=fixture(rows,{policy,mapping:{order:'ascending',projection}});
 for(const row of rows)row[0]=(await retainDatasetCell(f.materials,{value:row[0],kind:'string'},fn=>fn())).value;
 const {points,reader}=await f.run(),order=Array.from({length:33},(_,i)=>i).sort((a,b)=>a%3-b%3||a-b);assertBatches(f,33);assert.deepEqual(points.map(p=>p.y),order);
 for(let i=0;i<33;i++){const p=points[i];assert.equal(p.x,order[i]%3);assert.equal(p.source.coordinates.x.exact,String(base+BigInt(order[i]%3))+'/1');assert.deepEqual(p.source.coordinates.x.error,{numerator:'0',denominator:'1'});assert.deepEqual(p.source.source,source(order[i]));}
 const header=(await reader.header()).header;assert.equal(header.projection.x.origin.spelling.characters,origin.length);assert.deepEqual(header.projection.resourcePolicy,policy);let retainedOrigin='';for await(const part of reader.textChunks({collection:'header',id:header.id,field:'projection.x.origin.spelling'}))retainedOrigin+=part;assert.equal(retainedOrigin,origin);
});

test('missing batch points fail closed and cancellation after a batch read stops traversal',async()=>{
 const rows=Array.from({length:65},(_,i)=>[String(i),String(i)]);
 for(const order of ['source','ascending']){
  const missing=fixture(rows,{mapping:{order},onBatch:(values,batches)=>{if(batches.length===2)values.delete('point:0:40');}});await assert.rejects(missing.run(),{code:'MATERIAL_MISSING'});assert.equal(missing.batches.length,2);
  const stopped=new AbortController(),cancelled=fixture(rows,{mapping:{order},onBatch:(values,batches)=>{if(batches.length===2)stopped.abort();}});await assert.rejects(cancelled.run({signal:stopped.signal}),{name:'AbortError'});assert.equal(cancelled.batches.length,2);
 }
});

const dynamic={version:2,kind:'per-cell'},approximateCell={version:2,kind:'approximate',method:'pearson-centered-pairs-v1',engine:4,policy:defaultStructuredCalculationPolicy()},approximateFigure={version:1,kind:'approximate-inputs'};
test('mixed computed plots inspect contributing rows once and ignore excluded or unmapped approximations',async()=>{
 const policy=defaultDatasetResourcePolicy(),rows=Array.from({length:65},(_,i)=>[String(i),'0.5','0.25']),metadata=rows.map(()=>({cellComputations:[null,null,approximateCell]}));metadata[64]={excluded:'Explicit exclusion',cellComputations:[null,approximateCell,approximateCell]};
 for(const includedApproximate of [false,true]){const rowMetadata=structuredClone(metadata);if(includedApproximate)rowMetadata[42].cellComputations[1]=approximateCell;const f=fixture(rows,{policy,columnComputations:[null,dynamic,dynamic],rowMetadata}),{reader,result}=await f.run();assert.equal(f.sourceReads(),2,'source pages are not reread to classify computation');assert.equal(result.figure.document.counts.points,64);assert.deepEqual((await reader.header()).header.computation,includedApproximate?approximateFigure:undefined);}
});
test('plot reduction flags only included numeric contributors while count ignores unused value columns',async()=>{
 const policy=defaultDatasetResourcePolicy(),rows=[['0','0.5'],['0',''],['0','0.25']],rowMetadata=[{cellComputations:[null,null]},{cellComputations:[null,approximateCell]},{excluded:'Skip',cellComputations:[null,approximateCell]}];
 const reduced=fixture(rows,{policy,columnComputations:[null,dynamic],rowMetadata,mapping:{operation:'mean'}}),result=await reduced.run();assert.equal(result.points[0].y,0.5);assert.equal((await result.reader.header()).header.computation,undefined);
 const count=fixture(rows,{policy,columnComputations:[null,dynamic],rowMetadata,mapping:{operation:'count'}}),counted=await count.run();assert.equal(counted.points[0].y,2);assert.equal((await counted.reader.header()).header.computation,undefined);
 const bounds=fixture([['0','0.5','0.125']],{policy,columnComputations:[null,dynamic,dynamic],rowMetadata:[{cellComputations:[null,null,approximateCell]}],mapping:{values:[{column:1,error:2}]}}),bounded=await bounds.run();assert.equal(bounded.points[0].error,0.125);assert.deepEqual((await bounded.reader.header()).header.computation,approximateFigure);
 const invalid=fixture([['0','0.5']],{policy,columnComputations:[null,dynamic],rowMetadata:[{cellComputations:[null,undefined]}]});await assert.rejects(invalid.run(),{code:'DATASET_CELL_COMPUTATION'});
});
test('retained plot receipt verification replays actual computation in the existing bounded source pass',async()=>{
 const policy=defaultDatasetResourcePolicy(),f=fixture([['0','0.5'],['1','0.25']],{policy,columnComputations:[null,dynamic],rowMetadata:[{cellComputations:[null,approximateCell]},{cellComputations:[null,null]}]}),{result}=await f.run(),mapping={...f.selection.mapping,x:4,values:[{column:7,error:null}]},columns=Array.from({length:270},(_,i)=>({...defaultColumn({label:'Unselected '+i}),representation:'decimal'}));columns[4]=f.selection.columns[0];columns[7]=f.selection.columns[1];
 const source={content:{datasetFormat:3,rowCount:2,columns}},document={content:{tool:'Observanda table mapping',version:'10',figure:result.figure,mapping,parameters:JSON.stringify(mapping),inputs:[result.denominator.dataset],denominator:result.denominator,numericTransform:plotNumericalMetadata(mapping)}};
 f.materials.read=async()=>source;f.materials.datasetColumn=async(doc,index)=>doc.content.columns[index];f.materials.workspace.catalogue=async operation=>operation({db:{all:async()=>[{version:String(CATALOGUE_MAX_GENERATION)}]}});
 const before=f.sourceReads();await verifyPlotProjection(f.materials,document);assert.equal(f.sourceReads()-before,1,'verification uses its existing one-page source cache');
 f.pages[0].rows[0].cellComputations[1]=null;await assert.rejects(verifyPlotProjection(f.materials,document),{code:'CATALOGUE_DAMAGED'});
 delete f.pages[0].rows[1].cellComputations[1];await assert.rejects(verifyPlotProjection(f.materials,document),{code:'CATALOGUE_DAMAGED'});
});
