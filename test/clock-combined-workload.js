// One synthetic connected workload, invoked by the disposable segmented-clock
// native fixture. This helper does not start a database or manage recovery.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankClock,blankQuantity} from '../src/web/measurement-model.js';
import {exactUnitScalar as scalar} from '../src/web/measurement-unit-model.js';
import {readDatasetCell} from '../src/dataset-cell-storage.js';
import {analysisDependencyState} from '../src/analysis-dependencies.js';
const locate=(ref,row,column=0)=>({ref,selector:{kind:'cell',page:0,row,column}});
const position=row=>({page:0,row});
const rational=value=>scalar(String(value),'rational');
const text=async(materials,value)=>typeof value==='string'?value:(await readDatasetCell(materials,value,{limit:4096})).text;

export async function qualifyCombinedClockWorkload({materials:m,request,recordId,upload,policy,signal}){
 const evidence=await upload('combined-clock-declarations.txt','Synthetic counter: radix six, modulus 100 (base six). Explicit wrap/reset controls and per-epoch origin/wrap counts. External coordinates below are declared synthetic reference readings, not calendar, UTC, sidereal or ERA values.'),calibration=await m.analysis({recordId,title:'Combined counter calibration',inputs:[evidence],tool:'Declared synthetic counter calibration',version:'1',parameters:'Two counts per calibrated interval. Epoch coordinate = (counter + authored epoch wraps * 36 - authored epoch origin) / 2.'}),externalModel=await m.analysis({recordId,title:'Combined external reference declaration',inputs:[evidence],tool:'Declared synthetic reference coordinate',version:'1',parameters:'Exact paired event observations in an explicitly declared external coordinate. No civil-calendar or astronomical time-scale conversion.'});
 const raw=[['52','0','0','0','32'],['54','0','0','0','32'],['0','1','0','1','32'],['4','0','0','1','32'],['2','0','1','0','2'],['4','0','0','0','2'],['10','0','0','0','2'],['14','0','0','0','2'],['NA','0','0','0','2'],['20','0','0','0','2'],['22','0','0','0','2']],artifact=await upload('combined-counter.csv','Counter,Transition wraps,Reset,Epoch wraps,Epoch origin\n'+raw.map(row=>row.join(',')).join('\n'));
 const definition=counts=>({version:1,modulus:scalar('100','radix',6),rate:{counts:scalar(String(counts)),interval:scalar('1'),unit:'calibrated interval'}}),counter=(calibration,counts)=>({...defaultColumn({label:'Original senary counter'}),representation:'radix',radix:6,unit:'ticks',missing:[{value:'NA',meaning:'counter not observed'}],quantity:{origin:'measured',conversion:null,calibration},time:{kind:'counter',reference:'Declared synthetic device',resolution:'',uncertainty:'',clock:{...blankClock(),wrap:'observed',reset:'observed',model:calibration,referenceData:evidence,definition:definition(counts)}}}),controls=['Transition wraps','Reset','Epoch wraps','Epoch origin'].map((label,i)=>({...defaultColumn({label}),representation:'integer',unit:i===3?'ticks':''}));
 const initial=await m.dataset({recordId,title:'Combined original counter observations',artifact,columns:[counter(calibration,2),...controls]},{signal}),excluded=(await m.datasetPage(initial)).rows[9].id;let source=await m.dataset({recordId,title:'Combined original counter observations',id:initial.id,expectedRevision:initial.revision,artifact,baseDataset:initial,exclusions:{[excluded]:'Explicit synthetic excluded observation'}},{signal});
 let decoder=(await request('calculation-graph-create',{recordId,title:'Combined explicit epoch decoder',source,graphVersion:12,policy})).ref;const sourceBinding=(await request('calculation-graph-page',{ref:decoder,collection:'bindings'})).items[0],binding={id:sourceBinding.id,position:0},nodes=[];
 const address=i=>({id:nodes[i].id,position:i}),add=async value=>{const item={id:randomUUID(),...value};decoder=(await request('calculation-graph-change',{ref:decoder,collection:'nodes',offset:nodes.length,item})).ref;nodes.push(item);};
 for(const column of [0,3,4])await add({kind:'column',binding,column});
 await add({kind:'constant',value:{constant:'100',representation:'radix',radix:6,unit:'ticks'}});
 const operation=(operation,left,right,unit,quantity)=>({kind:'scalar',operation,left:address(left),right:address(right),condition:null,unit,...(quantity?{quantity}:{})});
 await add(operation('multiply',1,3,'ticks'));await add(operation('add',0,4,'ticks'));await add(operation('subtract',5,2,'ticks'));await add({kind:'constant',value:{constant:'2',representation:'integer',radix:10,unit:'ticks per calibrated interval'}});
 await add(operation('divide',6,7,'calibrated interval',{origin:'derived',conversion:calibration,calibration}));
 const transition={version:1,wraps:{kind:'column',column:1},resets:{kind:'column',column:2},ambiguity:'absent'};
 for(const operation of ['interval','status'])await add({kind:'clock',binding,column:0,operation,transition});
 for(const [offset,index]of [8,9,10].entries())decoder=(await request('calculation-graph-change',{ref:decoder,collection:'outputs',offset,item:{id:randomUUID(),name:['Declared epoch coordinate','Adjacent interval','Transition status'][offset],node:address(index)}})).ref;
 const decode=async(previous,calibration)=>{
  const calculated=await m.dataset({recordId,title:'Combined decoded epoch coordinates',...(previous?{id:previous.id,expectedRevision:previous.revision}:{}),calculation:{version:15,graph:decoder}},{signal}),column=await m.datasetColumn(await m.read(calculated),0);
  // Arithmetic produces a quantity; this separately authored schema declaration
  // gives that coordinate its explicit per-reset elapsed-time interpretation.
  const declared={...column,time:{kind:'inferred-elapsed',reference:'Authored counter origin for each declared reset epoch',resolution:'',uncertainty:'',clock:{...blankClock(),wrap:'none',reset:'observed',model:decoder,referenceData:source}}};
  assert.deepEqual(declared.quantity.calibration,calibration);
  return m.dataset({recordId,title:'Combined decoded epoch coordinates',id:calculated.id,expectedRevision:calculated.revision,artifact:decoder,baseDataset:calculated,columnChanges:[{index:0,column:declared}]},{signal});
 };
 let decoded=await decode(null,calibration);
 const referenceColumn=artifact=>({...defaultColumn({label:'Declared external coordinate'}),representation:'integer',unit:'external coordinate unit',quantity:{...blankQuantity(),origin:'measured',calibration:externalModel},time:{kind:'external',reference:'Declared synthetic external coordinate',resolution:'',uncertainty:'',clock:{...blankClock(),wrap:'none',reset:'none',epoch:'Synthetic reference epoch E',model:externalModel,referenceData:artifact}}});
 const referenceArtifact=await upload('combined-external.csv','External\n2080\n9999\n1000\n2000\n1040'),reference=await m.dataset({recordId,title:'Combined asynchronous external reference',artifact:referenceArtifact,columns:[referenceColumn(referenceArtifact)]},{signal});
 const synchronize=async(decoded,reference,upper,previous)=>{
  const target=await m.datasetColumn(await m.read(reference),0),header={version:2,method:'segmented-piecewise-affine-v1',source:{ref:decoded,column:0},reference:{ref:reference,column:0},target:{unit:target.unit,quantity:target.quantity,time:target.time},rationale:'Explicit paired event observations for two declared counter reset epochs; adjacent-anchor interpolation only.',resourcePolicy:policy};
  let model=(await request('clock-synchronization-create',{recordId,title:'Combined pinned external synchronization',synchronization:header})).ref;
  const segments=[];
  for(const [index,[first,last,anchorRows]]of [[0,3,[0,3]],[4,10,[4,7]]].entries()){
   const item={version:1,kind:'clock-sync-segment',id:randomUUID(),name:'Explicit reset epoch '+index,range:{first:position(first),last:position(last)},validity:{lower:rational('0/1'),upper:rational(upper)},rationale:'Authored reset boundary and observed paired events.',resourcePolicy:policy};segments.push(item);
   model=(await request('clock-synchronization-change',{ref:model,collection:'segments',offset:index,item})).ref;
   for(const [offset,row]of anchorRows.entries()){const referenceRow=index===0?[2,4][offset]:[3,0][offset];model=(await request('clock-synchronization-change',{ref:model,collection:'anchors',segment:{id:item.id,position:index},offset,item:{source:locate(decoded,row),reference:locate(reference,referenceRow)}})).ref;}
  }
  let graph=(await request('calculation-graph-create',{recordId,title:'Combined synchronized external coordinates',source:decoded,graphVersion:12,policy})).ref;const b=(await request('calculation-graph-page',{ref:graph,collection:'bindings'})).items[0];
  for(const [index,operation]of ['value','status'].entries()){const item={id:randomUUID(),kind:'clock-synchronize',binding:{id:b.id,position:0},column:0,model,operation,outside:'absent'};graph=(await request('calculation-graph-change',{ref:graph,collection:'nodes',offset:index,item})).ref;graph=(await request('calculation-graph-change',{ref:graph,collection:'outputs',offset:index,item:{id:randomUUID(),name:index?'Synchronization status':'External coordinate',node:{id:item.id,position:index}}})).ref;}
  const result=await m.dataset({recordId,title:'Combined retained external result',...(previous?{id:previous.id,expectedRevision:previous.revision}:{}),calculation:{version:15,graph}},{signal});return {result,model,graph,segments,header};
 };
 const old={source,decoder,decoded,calibration,reference,...await synchronize(decoded,reference,'4/1')};
 // A raw counter cannot enter the elapsed/external synchronization adapter.
 await assert.rejects(request('clock-synchronization-create',{recordId,title:'Refused raw counter shortcut',synchronization:{...old.header,source:{ref:source,column:0}}}),{code:'MEASUREMENT_CLOCK_SYNCHRONIZATION'});
 const firstRows=(await m.datasetPage(decoded)).rows;assert.deepEqual(firstRows.map(row=>row.cells[0]),['0/1','1/1','2/1','4/1','0/1','1/1','2/1','4/1','','','6/1']);
 assert.deepEqual(await Promise.all(firstRows.map(row=>text(m,row.cells[2]))),['no-predecessor','ready','ready','ready','reset','ready','ready','ready','missing-counter','excluded-current','excluded-previous']);assert.equal(firstRows[2].cells[1],'1/1');assert.equal(firstRows[4].valueKinds[1],'absent');
 const nextCalibration=await m.analysis({recordId,title:'Combined counter calibration',id:calibration.id,expectedRevision:calibration.revision,inputs:[evidence],tool:'Declared synthetic counter calibration',version:'2',parameters:'Four counts per calibrated interval. Explicit revision of the retained synthetic calibration; prior results remain pinned.'});
 source=await m.dataset({recordId,title:'Combined original counter observations',id:source.id,expectedRevision:source.revision,artifact,baseDataset:source,columnChanges:[{index:0,column:counter(nextCalibration,4)}]},{signal});
 decoder=(await request('calculation-graph-change',{ref:decoder,collection:'bindings',offset:0,item:{...sourceBinding,source}})).ref;
 nodes[7]={...nodes[7],value:{...nodes[7].value,constant:'4'}};decoder=(await request('calculation-graph-change',{ref:decoder,collection:'nodes',offset:7,item:nodes[7]})).ref;
 nodes[8]={...nodes[8],quantity:{origin:'derived',conversion:nextCalibration,calibration:nextCalibration}};decoder=(await request('calculation-graph-change',{ref:decoder,collection:'nodes',offset:8,item:nodes[8]})).ref;
 const revisedArtifact=await upload('combined-external-revised.csv','External\n2160\n9999\n1000\n2000\n1080'),revisedReference=await m.dataset({recordId,title:'Combined asynchronous external reference',id:reference.id,expectedRevision:reference.revision,artifact:revisedArtifact,columns:[referenceColumn(revisedArtifact)]},{signal});
 const changed=await analysisDependencyState(m,[{recordId,analysis:old.model}]);assert.ok(changed.items.some(item=>item.sample.some(ref=>ref.id===reference.id&&ref.current===revisedReference.revision)));
 assert.deepEqual((await m.datasetPage(old.result)).rows.map(row=>row.cells[0]),['1000/1','1010/1','1020/1','1040/1','2000/1','2020/1','2040/1','2080/1','','','']);
 decoded=await decode(decoded,nextCalibration);const next={source,decoder,decoded,calibration:nextCalibration,reference:revisedReference,...await synchronize(decoded,revisedReference,'2/1',old.result)};
 const check=async materials=>{
  const rawPage=await materials.datasetPage(old.source);assert.deepEqual(rawPage.rows.map(row=>row.cells[0]),raw.map(row=>row[0]));assert.equal(rawPage.rows[9].excluded,'Explicit synthetic excluded observation');const sourceColumn=await materials.datasetColumn(await materials.read(old.source),0);assert.equal(sourceColumn.representation,'radix');assert.equal(sourceColumn.radix,6);assert.deepEqual(sourceColumn.quantity.calibration,calibration);
  for(const [bundle,expected,elapsed]of [[old,['1000/1','1010/1','1020/1','1040/1','2000/1','2020/1','2040/1','2080/1','','',''],'2/1'],[next,['1000/1','1020/1','1040/1','1080/1','2000/1','2040/1','2080/1','2160/1','','',''],'1/1']]){
   const page=await materials.datasetPage(bundle.result);assert.deepEqual(page.rows.map(row=>row.cells[0]),expected);assert.deepEqual(page.rows.map(row=>row.order),Array.from({length:11},(_,i)=>i+1));assert.deepEqual(await Promise.all(page.rows.map(row=>text(materials,row.cells[1]))),['ready','ready','ready','ready','ready','ready','ready','ready','missing-input','excluded-input','outside-validity']);
   const output=await materials.datasetColumn(await materials.read(bundle.result),0);assert.equal(output.time.kind,'external');assert.deepEqual(output.time.clock.model,bundle.model);assert.deepEqual(output.time.clock.referenceData,bundle.reference);
   const decodedDoc=await materials.read(bundle.decoded),decodedColumn=await materials.datasetColumn(decodedDoc,0);assert.equal((await materials.datasetPage(bundle.decoded)).rows[2].cells[0],elapsed);assert.deepEqual(decodedColumn.quantity.calibration,bundle.calibration);assert.deepEqual(decodedColumn.time.clock.model,bundle.decoder);
   const sync=await materials.measurements.inspect(locate(bundle.result,2)),leaf=sync.lineage.items[0];assert.equal(leaf.synchronization.segment.position,0);assert.deepEqual(leaf.sources[0],locate(bundle.decoded,2));assert.deepEqual(leaf.sources[1].ref,bundle.model);assert.deepEqual(leaf.synchronization.bracket.map(item=>item.pair.reference.selector.row),[2,4]);
   const origin=await materials.measurements.inspect(locate(bundle.decoded,2));assert.deepEqual(origin.lineage.items.map(item=>item.column).sort((a,b)=>a-b),[0,3,4]);assert.ok(origin.lineage.items.every(item=>item.sources[0].ref.revision===bundle.source.revision&&item.sources[0].selector.row===2));
  }
  assert.notEqual(old.result.revision,next.result.revision);assert.equal(old.result.id,next.result.id);assert.equal((await materials.read(old.result)).content.calculation.graph.revision,old.graph.revision);assert.equal((await materials.read(next.result)).content.calculation.graph.revision,next.graph.revision);
  const interval=await materials.measurements.inspect(locate(old.decoded,2,1)),previous=interval.lineage.items.find(item=>item.relativeRow===-1);assert.deepEqual(previous.sources[0],locate(old.source,1));
 };
 await check(m);return {check,old:old.result,current:next.result};
}
