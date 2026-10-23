// Retained dataset plots keep only one row, reduction, and selected series in
// memory. Group/order/median state uses the existing encrypted scratch owner.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {PagedMedian} from './paged-median.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {createFigure,createSeries,xValue} from './web/figure-model.js';
import {FIGURE_OPERATIONS,figureMappingValueName,figureMappingPresentation} from './web/figure-import-model.js';
import {exactFigureValue,projectFigureValue} from './web/figure-mapping-values.js';
import {exactRational} from './web/measurement-model.js';
import {compareRationalText,sumRationalText,divideRationalText} from './web/measurement-reduction.js';
import {INTERVAL_FIELDS} from './web/figure-intervals.js';
import {assertDatasetScalars} from './dataset-selected-columns.js';
import messages from './web/locales/en/measurements.json' with {type:'json'};
const fail=(code='MATERIAL_INVALID')=>{throw new AppError(code);};
const checkCount=value=>{if(!Number.isSafeInteger(value)||value<0)fail('MATERIAL_ANALYSIS_LIMIT');return value;};
export function prepareRetainedPlot(materials,doc,command,selection,{write,signal,progress=async()=>{}}={}){
 return withScratch(async work=>{
  const mapping=selection.mapping,operation=mapping.operation??'raw',columns=selection.columns,values=operation==='count'?[{column:null,error:null}]:mapping.values;
  const table={columns:columns.map((column,index)=>({index,label:column.name+(column.unit?' ('+column.unit+')':''),heading:column.name}))};
  const absolute=index=>index===null?null:selection.indices?.[index]??index;
  const denominator={format:selection.indices?3:2,dataset:command.dataset,...(selection.indices?{columnIndices:selection.indices}:{}),rows:0,included:0,excludedCount:0,missing:columns.map((column,index)=>({column:absolute(index),name:column.name,count:0}))};
  let seriesCount=0,bucketCount=0,missing=0,rounded=false,collapsed=false,repeats=0,gaps=0,backwards=false;
  const makeRuns=(prefix,compareValues,midpoint)=>new PagedMedian({signal,pageBytes:262144,blockSize:128,compareValues,midpoint,
   read:name=>work.get(prefix+':page:'+name),write:(name,text)=>work.put(prefix+':page:'+name,text),remove:names=>work.removeMany(names.map(name=>prefix+':page:'+name)),
   state:{read:name=>work.get(prefix+':state:'+name),write:(name,value)=>work.put(prefix+':state:'+name,value)}});
  const median=operation==='median'?makeRuns('median',compareRationalText,(a,b)=>sumRationalText(a,b,2n)):null;
  const exact=(raw,index)=>{try{return exactFigureValue(raw,index,{parseNumber:(value,i)=>exactRational(value,columns[i].representation,columns[i].radix)});}catch{fail('MATERIAL_PRECISION');}};
  const project=(value,field,coordinates,{forceSafe=false}={})=>{
   try{const result=projectFigureValue(value,mapping,{axis:field[0]==='x'?'x':'y',delta:field==='error',forceSafe,transformed:field!=='count'});rounded ||= result.rounded;if(mapping.projection&&value!==null&&field!=='count')coordinates[field]={exact:value,error:result.error};return result.coordinate;}catch{fail('MATERIAL_PRECISION');}
  };
  async function seriesFor(value,group){
   const key='group:'+JSON.stringify([value.column,group]);let saved=await work.get(key);if(saved!==undefined)return saved;
   const base=group===null?figureMappingValueName(table,operation,value):values.length===1?group:figureMappingValueName(table,operation,value)+' - '+group;
   let name=base,suffix=2;while(!await work.add('name:'+name))name=base+' ('+(suffix++)+')';
   const position=checkCount(seriesCount++),header=createSeries(name,position);delete header.points;
   await work.put('series:'+position,{header,column:value.column,group,count:0});await work.put(key,position);return position;
  }
  for(let page=0;page<materials.datasetPageCount(doc);page++){
   signal?.throwIfAborted();const retained=await materials.readSnapshot(()=>materials.retainedDatasetPage(doc,page,selection.indices?{columns:selection.indices}:undefined));
   for(const [rowIndex,row]of retained.rows.entries()){
    signal?.throwIfAborted();denominator.rows++;if(row.excluded){denominator.excludedCount++;continue;}denominator.included++;assertDatasetScalars(row);
    const cells=row.cells.map((raw,index)=>{if(['null','absent'].includes(row.valueKinds?.[index])||columns[index].missing.some(value=>value.value===raw)){denominator.missing[index].count++;return '';}return raw;});
    const rawX=cells[mapping.x].trim(),horizontal=mapping.xKind==='number'?exact(rawX,mapping.x):rawX,group=mapping.group===null?null:cells[mapping.group].trim(),source={page,row:rowIndex};
    if(horizontal===null||mapping.xKind!=='number'&&xValue(horizontal,mapping.xKind)===null||group==='')fail();
    for(const value of values){
     const series=await seriesFor(value,group),state=await work.get('series:'+series),y=operation==='count'?'1/1':exact(cells[value.column],value.column);
     if(operation==='raw'){
      const coordinates={},point={x:mapping.xKind==='number'?project(horizontal,'x',coordinates):horizontal,y:project(y,'y',coordinates),error:value.error===null?null:project(exact(cells[value.error],value.error),'error',coordinates)};
      if(point.y===null&&point.error!==null)fail();
      for(const field of INTERVAL_FIELDS)if(value[field]!=null){const raw=cells[value[field]].trim();point[field]=!raw?null:field[0]==='x'&&mapping.xKind==='date'?raw:project(exact(raw,value[field]),field,coordinates);}
      if(value.count!=null)point.count=project(exact(cells[value.count],value.count),'count',coordinates,{forceSafe:true});
      await work.put('point:'+series+':'+state.count,{point,exactX:horizontal,position:state.count,source,coordinates});state.count=checkCount(state.count+1);
     }else{
      const key='bucket:'+series+':'+horizontal;let bucket=await work.get(key);
      if(bucket===undefined){bucket=checkCount(bucketCount++);await work.put(key,bucket);await work.put('point:'+series+':'+state.count,{bucket,exactX:horizontal,position:state.count});state.count=checkCount(state.count+1);await work.put('reduction:'+bucket,{n:0,sum:'0/1',min:null,max:null,members:0});}
      const reduced=await work.get('reduction:'+bucket);await work.put('member:'+bucket+':'+reduced.members,source);reduced.members=checkCount(reduced.members+1);
      if(y===null)missing++;else{reduced.n=checkCount(reduced.n+1);if(operation==='sum'||operation==='mean')reduced.sum=sumRationalText(reduced.sum,y);if(operation==='min'&&(reduced.min===null||compareRationalText(y,reduced.min)<0))reduced.min=y;if(operation==='max'&&(reduced.max===null||compareRationalText(y,reduced.max)>0))reduced.max=y;if(median)median.add(bucket,y);}
      await work.put('reduction:'+bucket,reduced);
     }
     await work.put('series:'+series,state);await median?.flush();
    }
   }
   await progress({stage:'calculating dataset rows',done:denominator.rows,total:doc.content.rowCount});
  }
  if(denominator.rows!==doc.content.rowCount)fail('MATERIAL_MISSING');await median?.finish();signal?.throwIfAborted();
  const header=figureMappingPresentation(table,mapping,command.base??createFigure(),{seriesCount,rows:denominator.included,missing});
  const builder=new RetainedFigureDocuments(materials.workspace,{write,signal}).builder(header);await builder.addPlot(header);
  const members=operation==='raw'?null:materials.sequences.builder('plot-members',write);
  async function* entries(series,state){
   if(mapping.order!=='ascending'||mapping.xKind==='category'){for(let at=0;at<state.count;at++){signal?.throwIfAborted();yield await work.get('point:'+series+':'+at);}return;}
   const runs=makeRuns('order:'+series,(a,b)=>(mapping.xKind==='number'?compareRationalText(a.exactX,b.exactX):xValue(a.exactX,'date')-xValue(b.exactX,'date'))||a.position-b.position);
   for(let at=0;at<state.count;at++){signal?.throwIfAborted();runs.add(0,await work.get('point:'+series+':'+at));await runs.flush();}await runs.flush(true);
   let run=null;for(const part of runs.levels)if(part)run=run?await runs.merge(run,part):part;
   if(run){for await(const [,entry]of runs.values(run))yield entry;await runs.discard(run);}
  }
  for(let series=0;series<seriesCount;series++){
   signal?.throwIfAborted();const state=await work.get('series:'+series);await builder.addSeries(state.header);let previous=null;
   for await(const entry of entries(series,state)){
    signal?.throwIfAborted();let point=entry.point,coordinates=entry.coordinates,receipt;
    if(operation==='raw')receipt={version:2,column:absolute(state.column),group:state.group,coordinates,source:entry.source};
    else{
     const reduced=await work.get('reduction:'+entry.bucket);let y=null;
     if(reduced.n)y=operation==='count'?reduced.n+'/1':operation==='sum'?reduced.sum:operation==='mean'?divideRationalText(reduced.sum,reduced.n):operation==='min'?reduced.min:operation==='max'?reduced.max:await median.value(entry.bucket);
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
 },{signal});
}
