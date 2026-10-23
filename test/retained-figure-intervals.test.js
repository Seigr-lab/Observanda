import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {inspectPlotPoint} from '../src/dataset-plot-provenance.js';
import {DATASET_ROWS_PER_PAGE} from '../src/dataset-row-position.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {createFigure} from '../src/web/figure-model.js';
import {retainedFigureSVG} from '../src/web/retained-figure-svg.js';
import {retainedFigureCSV} from '../src/web/retained-figure-data.js';
import {readDelimitedTable} from '../src/web/tabular-data.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

const count=1025,groups=257,epoch=Date.parse('2025-01-02T23:55:00.000Z');
const stamp=(index,delta=0)=>new Date(epoch+index*1000+delta).toISOString();
const point=index=>({x:stamp(index),y:index+20,error:null,xLower:stamp(index,-250),xUpper:stamp(index,500),yLower:index+18,yUpper:index+25});
// Consume complete exports while retaining at most one CSV row or token suffix.
async function exportedCSV(reader,{signal,grouped,last}){
 const hash=createHash('sha256');let line='',observations=0,series=0,lastRow;
 for await(const chunk of retainedFigureCSV(reader,{signal})){
  assert.ok(Buffer.byteLength(chunk)<=65536);hash.update(chunk);line+=chunk;
  for(let end;(end=line.indexOf('\n'))!==-1;){const row=line.slice(0,end);line=line.slice(end+1);if(!row)continue;const cells=readDelimitedTable(row,{header:false}).rows[0].cells;
   if(cells[0]==='series settings')series++;
   if(cells[0]!=='measurement')continue;
   const index=Number(cells[7])-20,expected=point(index),value=JSON.parse(cells.at(-1));assert.ok(Number.isSafeInteger(index)&&index>=0&&index<count);
   assert.deepEqual(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='source')),expected);assert.equal(cells[6],expected.x);assert.deepEqual(cells.slice(9,13),[expected.xLower,expected.xUpper,String(expected.yLower),String(expected.yUpper)]);
   assert.equal(value.source.group,grouped?'Series '+(index%groups):null);observations++;lastRow=cells;
  }
  assert.ok(Buffer.byteLength(line)<16384,'only one bounded CSV metadata/measurement row is retained');
 }
 assert.equal(line,'');assert.equal(observations,count);assert.equal(series,grouped?groups:1);assert.equal(lastRow[3],last.id);assert.equal(lastRow[2],last.seriesId);return hash.digest('hex');
}
async function exportedSVG(reader,{signal,last,grouped}){
 const hash=createHash('sha256'),tokens=['class="figure-observation"','class="figure-series-graphic"','figure-interval-x','figure-interval-y','data-point-id="'+last.id+'"'],states=tokens.map(token=>({token,tail:'',count:0}));
 for await(const chunk of retainedFigureSVG(reader,{signal})){
  assert.ok(Buffer.byteLength(chunk)<=65536);assert.doesNotMatch(chunk,/NaN|Infinity|undefined/);hash.update(chunk);
  for(const state of states){const text=state.tail+chunk;let offset=0;for(;;){const at=text.indexOf(state.token,offset);if(at<0)break;state.count++;offset=at+state.token.length;}state.tail=text.slice(-(state.token.length-1));}
 }
 assert.deepEqual(states.map(s=>s.count),[count,grouped?groups:1,count,count,1]);return hash.digest('hex');
}

test('dense chronological and many-series interval mappings retain every point, complete exports and exact sources through encrypted restoration',{timeout:600000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-intervals-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),recordId=book.entries[0].id,m=new ResearchMaterials(f.workspace),started=performance.now();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 // Counts cover catalogue calls after Workspace admission, including get/all
 // through run; pre-open authentication, scratch and direct archive handles are
 // outside this observation. Only aggregate counts are emitted.
 const calls={opens:0,queries:0,transactions:0},open=Workspace.prototype.openCatalogue;
 t.mock.method(Workspace.prototype,'openCatalogue',async function(...args){const db=await open.apply(this,args),run=db.run.bind(db);calls.opens++;db.run=async(...query)=>{calls.queries++;if(query[0].startsWith('BEGIN'))calls.transactions++;return run(...query);};return db;});
 let previous={elapsed:0,...calls};
 const stage=name=>{const elapsed=Math.round(performance.now()-started);process.stdout.write('# '+JSON.stringify({stage:name,elapsedMs:elapsed,stageMs:elapsed-previous.elapsed,opens:calls.opens-previous.opens,catalogueRunCalls:calls.queries-previous.queries,transactions:calls.transactions-previous.transactions})+'\n');previous={elapsed,...calls};};
 const bytes=Buffer.from(['time,value,lower time,upper time,lower value,upper value,series',...Array.from({length:count},(_,i)=>{const p=point(i);return [p.x,p.y,p.xLower,p.xUpper,p.yLower,p.yUpper,'Series '+i%groups].join(',');})].join('\n'));
 const upload=await m.startImport({recordId,name:'chronological-intervals.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id),columns=['time','value','lower time','upper time','lower value','upper value','series'].map((name,i)=>({...defaultColumn({label:name}),representation:[1,4,5].includes(i)?'decimal':'text',unit:[0,2,3].includes(i)?'s':[1,4,5].includes(i)?'V':''})),dataset=await m.dataset({recordId,title:'Timestamped interval observations',artifact,columns},{signal:t.signal});stage('Dataset retained');
 const mapping={x:0,xKind:'date',values:[{column:1,error:null,xLower:2,xUpper:3,yLower:4,yUpper:5}],group:null,operation:'raw',kind:'line',order:'ascending',mode:'replace',decimal:'.'},command={recordId,title:'Dense chronological trace',dataset,mapping,base:createFigure()},trace=await m.plot(command,{signal:t.signal});stage('Dense chronological trace retained');
 const intervals=await m.plot({...command,title:'Many-series interval observations',mapping:{...mapping,group:6,kind:'scatter'}},{signal:t.signal});stage('257 interval series retained');
 await assert.rejects(m.plot({...command,mapping:{...mapping,values:[{...mapping.values[0],xLower:4}]}},{signal:t.signal}),{code:'MATERIAL_INVALID'});
 const check=async(workspace,previous)=>{
  const materials=new ResearchMaterials(workspace),receipts=[];
  for(const [grouped,result]of [[false,trace],[true,intervals]]){
   const expectedIndex=grouped?770:1024,receipt=await materials.readSnapshot(async()=>{
    const doc=await materials.read(result.ref);assert.equal(doc.content.version,'9');assert.deepEqual(doc.content.inputs,[dataset]);assert.deepEqual(doc.content.mapping,grouped?{...mapping,group:6,kind:'scatter'}:mapping);assert.equal(doc.content.figure.series,undefined);
    const reader=await new RetainedFigureDocuments(workspace,{readOnly:true,signal:t.signal}).open(doc.content.figure),header=await reader.header();assert.equal(header.counts.points,count);assert.equal(header.counts.series,grouped?groups:1);assert.equal(header.header.x.kind,'date');
    const series=(await reader.window({collection:'series',offset:grouped?256:0,limit:1})).items[0];assert.equal(series.position,grouped?256:0);assert.equal(series.points,grouped?3:count);
    const tail=await reader.window({collection:'points',seriesId:series.id,offset:series.points-1,limit:1});assert.equal(tail.next,null);assert.equal(tail.items.length,1);const last=tail.items[0];assert.deepEqual(await reader.item({collection:'points',seriesId:series.id,id:last.id}),last);assert.deepEqual(Object.fromEntries(Object.entries(last.value).filter(([key])=>key!=='source')),point(expectedIndex));
    const csv=await exportedCSV(reader,{signal:t.signal,grouped,last}),svg=await exportedSVG(reader,{signal:t.signal,grouped,last});return {last,csv,svg};
   });
   const exact=await inspectPlotPoint(materials,result.ref,undefined,{pointId:receipt.last.id,seriesId:receipt.last.seriesId,signal:t.signal});assert.equal(exact.total,1);assert.equal(exact.next,null);assert.deepEqual(exact.coordinate,point(expectedIndex));assert.deepEqual(exact.members[0].position,{page:Math.floor(expectedIndex/DATASET_ROWS_PER_PAGE),row:expectedIndex%DATASET_ROWS_PER_PAGE});
   for(const [field,column,spelling]of [['x',0,stamp(expectedIndex)],['y',1,String(expectedIndex+20)],['yUpper',5,String(expectedIndex+25)]]){const source=exact.members[0].cells.find(cell=>cell.field===field).source;assert.deepEqual(source.ref,dataset);assert.equal(source.selector.column,column);assert.equal((await materials.measurements.inspect(source,{signal:t.signal})).value.spelling,spelling);}
   receipts.push(receipt);
  }
  if(previous)assert.deepEqual(receipts,previous);return receipts;
 };
 const original=await check(new Workspace(f.workspace.root,f.vault));stage('Complete SVG/CSV and stable last-point source verified');
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup'),{vault:f.vault,signal:t.signal}),{vault:f.vault,signal:t.signal});stage('Encrypted restoration completed');
 await check(new Workspace(backup,f.vault),original);stage('Restored complete exports and exact identities verified');
});
