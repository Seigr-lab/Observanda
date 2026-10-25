import {plotComputationHeader,createPlotComputation,plotComputationIndices} from './dataset-plot-selection.js';
import {plotOperation,plotScalarOperation,plotComputationFailure} from './plot-resource-policy.js';
// Row/reduction processing selects one series at a time. Scratch point reads
// stage at most 32 records: a count bound, not a byte bound on exact coordinates.
// Group/order/median state uses the existing encrypted scratch owner.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {PagedMedian} from './paged-median.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {withDatasetPreparationWrites} from './dataset-preparation-writes.js';
import {createFigure,createSeries,xValue} from './web/figure-model.js';
import {FIGURE_OPERATIONS,figureMappingValueName,figureMappingPresentation} from './web/figure-import-model.js';
import {projectFigureValue} from './web/figure-mapping-values.js';
import {plotRationalText} from './web/plot-resource-policy.js';
import {rationalText} from './web/dataset-calculation-model.js';
import {compareRationalText,sumRationalText,divideRationalText} from './web/measurement-reduction.js';
import {INTERVAL_FIELDS} from './web/figure-intervals.js';
import {assertDatasetScalars} from './dataset-selected-columns.js';
import messages from './web/locales/en/measurements.json' with {type:'json'};
const fail=(code='MATERIAL_INVALID')=>{throw new AppError(code);};
const checkCount=value=>{if(!Number.isSafeInteger(value)||value<0)fail('MATERIAL_ANALYSIS_LIMIT');return value;};
export function prepareRetainedPlot(materials,doc,command,selection,{write,signal,progress=async()=>{}}={}){
 return withScratch(async work=>{
  const computation=createPlotComputation(selection);if(computation.dynamic&&!selection.mapping.resourcePolicy)fail();
  const mapping=selection.mapping,operation=mapping.operation??'raw',columns=selection.columns,values=operation==='count'?[{column:null,error:null}]:mapping.values;
  const scalarIndices=plotComputationIndices(mapping);
  const table={columns:columns.map((column,index)=>({index,label:column.name+(column.unit?' ('+column.unit+')':''),heading:column.name}))};
  const absolute=index=>index===null?null:selection.indices?.[index]??index;
  const denominator={format:selection.indices?3:2,dataset:command.dataset,...(selection.indices?{columnIndices:selection.indices}:{}),rows:0,included:0,excludedCount:0,missing:columns.map((column,index)=>({column:absolute(index),name:column.name,count:0}))};
  let seriesCount=0,bucketCount=0,missing=0,rounded=false,collapsed=false,repeats=0,gaps=0,backwards=false;
  // This scratch owner is exclusive to the calculation. Only bounded grouping
  // metadata and pending contributions stay in memory; output traversals read
  // members, points and sort runs from encrypted scratch.
  const metadata=new Map(),pending=new Map();let metadataBytes=0,pendingBytes=0;
  const isMetadata=key=>/^(group|series|bucket|reduction):/.test(key);
  const remember=(key,value)=>{
   const prior=metadata.get(key);if(prior){metadataBytes-=prior.bytes;metadata.delete(key);}
   const bytes=Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(value)??'null');if(bytes>256*1024)return;
   while(metadata.size>=64||metadataBytes+bytes>256*1024){const first=metadata.keys().next().value;metadataBytes-=metadata.get(first).bytes;metadata.delete(first);}
   metadata.set(key,{value:structuredClone(value),bytes});metadataBytes+=bytes;
  };
  const readMetadata=async key=>{signal?.throwIfAborted();const staged=pending.get(key);if(staged)return structuredClone(staged.value);const cached=metadata.get(key);if(cached){metadata.delete(key);metadata.set(key,cached);return structuredClone(cached.value);}
   const value=await work.get(key);signal?.throwIfAborted();remember(key,value);return value;
  };
  const writeEntries=async entries=>{signal?.throwIfAborted();await work.putMany(entries);signal?.throwIfAborted();for(const [key,value]of entries)if(isMetadata(key))remember(key,value);};
  const flush=async()=>{signal?.throwIfAborted();if(!pending.size)return;await writeEntries([...pending].map(([key,entry])=>[key,entry.value]));pending.clear();pendingBytes=0;};
  const saveEntries=async entries=>{
   signal?.throwIfAborted();let count=pending.size,bytes=pendingBytes,total=0;
   const sizes=entries.map(([key,value])=>{const size=Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(value)),prior=pending.get(key);total+=size;bytes+=size-(prior?.bytes??0);if(!prior)count++;return size;});
   // Flush whole contributions: no batch can persist a member without the
   // reduction that includes it. Oversized contributions keep direct writes.
   if(total>256*1024){await flush();return writeEntries(entries);}
   if(count>32||bytes>256*1024)await flush();
   for(const [index,[key,value]]of entries.entries()){
    pendingBytes-=pending.get(key)?.bytes??0;pending.set(key,{value:structuredClone(value),bytes:sizes[index]});pendingBytes+=sizes[index];
   }
   if(pending.size===32||pendingBytes===256*1024)await flush();
  };
  const makeRuns=(prefix,compareValues,midpoint)=>new PagedMedian({signal,pageBytes:262144,blockSize:128,compareValues,midpoint,
   read:name=>work.get(prefix+':page:'+name),write:(name,text)=>work.put(prefix+':page:'+name,text),remove:names=>work.removeMany(names.map(name=>prefix+':page:'+name)),
   state:{read:name=>work.get(prefix+':state:'+name),write:(name,value)=>work.put(prefix+':state:'+name,value)}});
  const compare=(a,b)=>plotOperation(mapping,budget=>compareRationalText(a,b,budget)),sum=(a,b,divisor=1n)=>plotOperation(mapping,budget=>sumRationalText(a,b,divisor,budget)),divide=(a,b)=>plotOperation(mapping,budget=>divideRationalText(a,b,budget));
  const median=operation==='median'?makeRuns('median',compare,(a,b)=>sum(a,b,2n)):null;
  const exact=async(raw,index,row)=>{const column=computation.column(row,index);let result;try{result=await plotScalarOperation(materials,raw,column,mapping,(value,budget)=>budget?plotRationalText(value,budget):rationalText(value),{signal});}catch(error){plotComputationFailure(error);}computation.contribute(row,index,result!==null);return result;};
  const scalar=value=>{if(typeof value!=='string')fail('DATASET_CELL_SCALAR_REQUIRED');return value;};
  const project=(value,field,coordinates,{forceSafe=false}={})=>{
   try{const result=projectFigureValue(value,mapping,{axis:field[0]==='x'?'x':'y',delta:field==='error',forceSafe,transformed:field!=='count'});rounded ||= result.rounded;if(mapping.projection&&value!==null&&field!=='count')coordinates[field]={exact:value,error:result.error};return result.coordinate;}catch(error){plotComputationFailure(error);}
  };
  async function seriesFor(value,group){
   const key='group:'+JSON.stringify([value.column,group]);let saved=await readMetadata(key);if(saved!==undefined)return saved;
   const base=group===null?figureMappingValueName(table,operation,value):values.length===1?group:figureMappingValueName(table,operation,value)+' - '+group;
   let name=base,suffix=2;while(!await work.add('name:'+name))name=base+' ('+(suffix++)+')';
   const position=checkCount(seriesCount++),header=createSeries(name,position);delete header.points;
   await saveEntries([['series:'+position,{header,column:value.column,group,count:0}],[key,position]]);return position;
  }
  for(let page=0;page<materials.datasetPageCount(doc);page++){
   signal?.throwIfAborted();const retained=await materials.readSnapshot(()=>materials.retainedDatasetPage(doc,page,selection.indices?{columns:selection.indices}:undefined));
   for(const [rowIndex,row]of retained.rows.entries()){
    signal?.throwIfAborted();denominator.rows++;if(row.excluded){denominator.excludedCount++;continue;}denominator.included++;if(!mapping.resourcePolicy)assertDatasetScalars(row,scalarIndices);
    const cells=row.cells.map((raw,index)=>{if(['null','absent'].includes(row.valueKinds?.[index])||columns[index].missing.some(value=>value.value===raw)){denominator.missing[index].count++;return '';}return raw;});
    const horizontal=mapping.xKind==='number'?await exact(cells[mapping.x],mapping.x,row):scalar(cells[mapping.x]).trim(),group=mapping.group===null?null:scalar(cells[mapping.group]).trim(),source={page,row:rowIndex};
    if(horizontal===null||mapping.xKind!=='number'&&xValue(horizontal,mapping.xKind)===null||group==='')fail();if(mapping.xKind!=='number')computation.contribute(row,mapping.x);if(mapping.group!==null)computation.contribute(row,mapping.group);
    for(const value of values){
     const series=await seriesFor(value,group),state=await readMetadata('series:'+series),y=operation==='count'?'1/1':await exact(cells[value.column],value.column,row),entries=[];
     let changedSeries=false;
     if(operation==='raw'){
      const coordinates={},point={x:mapping.xKind==='number'?project(horizontal,'x',coordinates):horizontal,y:project(y,'y',coordinates),error:value.error===null?null:project(await exact(cells[value.error],value.error,row),'error',coordinates)};
      if(point.y===null&&point.error!==null)fail();
      for(const field of INTERVAL_FIELDS)if(value[field]!=null){const raw=cells[value[field]];point[field]=field[0]==='x'&&mapping.xKind==='date'?(scalar(raw).trim()||null):project(await exact(raw,value[field],row),field,coordinates);if(field[0]==='x'&&mapping.xKind==='date')computation.contribute(row,value[field],point[field]!==null);}
      if(value.count!=null)point.count=project(await exact(cells[value.count],value.count,row),'count',coordinates,{forceSafe:true});
      entries.push(['point:'+series+':'+state.count,{point,exactX:horizontal,position:state.count,source,coordinates}]);state.count=checkCount(state.count+1);changedSeries=true;
     }else{
      const key='bucket:'+series+':'+horizontal;let bucket=await readMetadata(key),reduced;
      if(bucket===undefined){bucket=checkCount(bucketCount++);entries.push([key,bucket],['point:'+series+':'+state.count,{bucket,exactX:horizontal,position:state.count}]);state.count=checkCount(state.count+1);changedSeries=true;reduced={n:0,sum:'0/1',min:null,max:null,members:0};}
      else reduced=await readMetadata('reduction:'+bucket);
      entries.push(['member:'+bucket+':'+reduced.members,source]);reduced.members=checkCount(reduced.members+1);
      if(y===null)missing++;else{reduced.n=checkCount(reduced.n+1);if(operation==='sum'||operation==='mean')reduced.sum=sum(reduced.sum,y);if(operation==='min'&&(reduced.min===null||compare(y,reduced.min)<0))reduced.min=y;if(operation==='max'&&(reduced.max===null||compare(y,reduced.max)>0))reduced.max=y;if(median)median.add(bucket,y);}
      entries.push(['reduction:'+bucket,reduced]);
     }
     if(changedSeries)entries.push(['series:'+series,state]);await saveEntries(entries);await median?.flush();
    }
   }
   await progress({stage:'calculating dataset rows',done:denominator.rows,total:doc.content.rowCount});
  }
  if(denominator.rows!==doc.content.rowCount)fail('MATERIAL_MISSING');await flush();await median?.finish();signal?.throwIfAborted();
  const header=plotComputationHeader(figureMappingPresentation(table,mapping,command.base??createFigure(),{seriesCount,rows:denominator.included,missing}),selection,computation);
  const retain=async memberMaterials=>{
  const builder=new RetainedFigureDocuments(materials.workspace,{write,signal}).builder(header);await builder.addPlot(header);
  // Only member sequences share bounded immutable-write batches. Source reads
  // and figure blocks keep their original owners and transaction boundaries.
  const members=operation==='raw'?null:memberMaterials.sequences.builder('plot-members',fn=>fn());
  async function* entries(series,state){
   const runs=mapping.order==='ascending'&&mapping.xKind!=='category'?makeRuns('order:'+series,(a,b)=>(mapping.xKind==='number'?compare(a.exactX,b.exactX):xValue(a.exactX,'date')-xValue(b.exactX,'date'))||a.position-b.position):null;
   for(let at=0;at<state.count;at+=32){
    signal?.throwIfAborted();const keys=Array.from({length:Math.min(32,state.count-at)},(_,i)=>'point:'+series+':'+(at+i)),batch=await work.getMany(keys);
    for(const key of keys){signal?.throwIfAborted();const entry=batch.get(key);if(!entry)fail('MATERIAL_MISSING');if(runs){runs.add(0,entry);await runs.flush();}else yield entry;}
   }
   if(!runs)return;await runs.flush(true);
   let run=null;for(const part of runs.levels)if(part)run=run?await runs.merge(run,part):part;
   if(run){for await(const [,entry]of runs.values(run))yield entry;await runs.discard(run);}
  }
  for(let series=0;series<seriesCount;series++){
   signal?.throwIfAborted();const state=await readMetadata('series:'+series);await builder.addSeries(state.header);let previous=null;
   for await(const entry of entries(series,state)){
    signal?.throwIfAborted();let point=entry.point,coordinates=entry.coordinates,receipt;
    if(operation==='raw')receipt={version:2,column:absolute(state.column),group:state.group,coordinates,source:entry.source};
    else{
     const reduced=await readMetadata('reduction:'+entry.bucket);let y=null;
     if(reduced.n)y=operation==='count'?reduced.n+'/1':operation==='sum'?reduced.sum:operation==='mean'?divide(reduced.sum,reduced.n):operation==='min'?reduced.min:operation==='max'?reduced.max:await median.value(entry.bucket);
     coordinates={};point={x:mapping.xKind==='number'?project(entry.exactX,'x',coordinates):entry.exactX,y:project(y,'y',coordinates),error:null};
     receipt={version:2,column:absolute(state.column),group:state.group,coordinates,members:{offset:members.count,count:reduced.members}};
     for(let at=0;at<reduced.members;at+=32){const keys=Array.from({length:Math.min(32,reduced.members-at)},(_,i)=>'member:'+entry.bucket+':'+(at+i)),batch=await work.getMany(keys);for(const key of keys){signal?.throwIfAborted();const source=batch.get(key);if(!source)fail('MATERIAL_MISSING');await members.append(source);}}
    }
    if(mapping.xKind==='number'){const key='projected:'+point.x,prior=await work.get(key);if(prior!==undefined&&prior!==entry.exactX)collapsed=true;else if(prior===undefined)await work.put(key,entry.exactX);}
    if(!await work.add('seen:'+series+':'+JSON.stringify(point.x)))repeats++;if(point.y===null)gaps++;
    const current=xValue(point.x,mapping.xKind);if(mapping.xKind!=='category'&&previous!==null&&current<previous)backwards=true;previous=current;
    if(Buffer.byteLength(JSON.stringify(receipt))>900000)fail('MATERIAL_ANALYSIS_LIMIT');await builder.addPoint(point,{id:randomUUID(),source:receipt});
   }
  }
  const figure=await builder.finish(),warnings=[];
  if(operation!=='raw')warnings.push(FIGURE_OPERATIONS.find(([id])=>id===operation)[1]+' calculated from '+denominator.included+' rows.'+(missing?' '+missing+' empty values excluded; groups with no values stay empty.':''));
  if(rounded)warnings.push(messages.plotRounded);if(collapsed)warnings.push(messages.plotCollapsed);
  if(repeats&&operation==='raw')warnings.push(repeats+' repeated coordinates are retained as separate measurements.'+(['bar','bar-horizontal'].includes(header.kind)?' Bars at the same coordinate will overlap; use scatter to see individual observations.':''));
  if(backwards&&['line','area'].includes(header.kind))warnings.push('Coordinates go backwards in file order. Choose Sort by coordinate to connect them in ascending order, or use scatter.');if(gaps)warnings.push(gaps+' empty values will remain gaps.');
  return {figure,denominator,warnings,...(members?{plotMembersIndex:await members.finish()}:{})};
  };
  return operation==='raw'?retain(materials):withDatasetPreparationWrites(materials,{writePage:write,signal},retain);
 },{signal});
}
