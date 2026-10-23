import {exactFigureValue,projectFigureValue} from './figure-mapping-values.js';
import {defaultMarkerArea} from './figure-marker-area.js';
import markerMessages from './locales/en/figureMarkerArea.json' with {type:'json'};
import {INTERVAL_FIELDS} from './figure-intervals.js';
import intervalMessages from './locales/en/figureIntervals.json' with {type:'json'};
import heatmapMessages from './locales/en/figureHeatmap.json' with {type:'json'};
import {defaultHeatmap} from './figure-heatmap.js';
import {createSeries, figureIssues, xValue} from './figure-model.js';
import {tableNumber} from './tabular-data.js';
import {rationalProjection,safeRationalProjection} from './measurement-projection.js';
import {projectTransformedValue,validMeasurementProjection} from './measurement-transform.js';
import {exactRational} from './measurement-model.js';
import {rationalText} from './dataset-calculation-model.js';
import {compareRationalText,sumRationalText,divideRationalText} from './measurement-reduction.js';
import measurementMessages from './locales/en/measurements.json' with {type:'json'};

export function figureColumns(table, decimal = '.') {
  return table.columns.map(column => {
    let filled = 0, numeric = 0, dates = 0;
    for (const row of table.rows) {
      const value = row.cells[column.index].trim();
      if (!value) continue;
      filled++;
      if (Number.isFinite(tableNumber(value, decimal))) numeric++;
      if (xValue(value, 'date') !== null) dates++;
    }
    return {...column, filled, numeric, kind: !filled ? 'empty' : numeric === filled ? 'number' : dates === filled ? 'date' : numeric ? 'mixed' : 'text'};
  });
}

export const FIGURE_OPERATIONS=[['raw','Individual measurements'],['count','Count rows'],['mean','Mean'],['median','Median'],['sum','Sum'],['min','Minimum'],['max','Maximum']];

export function suggestFigureMapping(table, figure, decimal = '.') {
  const columns = figureColumns(table, decimal);
  const exported = columns.length === 4 && columns[0].heading === 'Series' && columns[3].heading === 'Uncertainty';
  const x = exported ? 1 : 0;
  const xKind = columns[x].kind === 'date' ? 'date' : columns[x].kind === 'number' ? 'number' : 'category';
  return {
    x, xKind, decimal, operation:'raw',
    values: exported ? [{column: 2, error: 3}] : columns.filter(c => c.index !== x && c.kind === 'number').map(c => ({column: c.index, error: null})),
    group: exported ? 0 : null,
    order: 'source',
    kind: xKind === 'category' ? 'bar-horizontal' : figure.kind,
    mode: 'replace'
  };
}

export function figureMappingValueName(table,operation,value){return value.column===null?'Count':operation==='raw'?table.columns[value.column].label:FIGURE_OPERATIONS.find(([id])=>id===operation)[1]+' of '+table.columns[value.column].label;}
export function figureMappingPresentation(table,mapping,figure,{seriesCount,rows,missing}){
 const operation=mapping.operation??'raw',values=operation==='count'?[{column:null,error:null}]:mapping.values;
 const next=structuredClone(Object.fromEntries(Object.entries(figure).filter(([key])=>!['series','source'].includes(key))));next.kind=mapping.kind;
 if(mapping.projection)next.projection=structuredClone(mapping.projection);else delete next.projection;
 if(mapping.values.some(v=>v.count!=null))next.markerArea??=defaultMarkerArea();else delete next.markerArea;
 if(next.kind==='heatmap'){next.heatmap??=defaultHeatmap();next.x.scale='linear';next.y.scale='linear';}
 next.x={...next.x,kind:mapping.xKind,label:table.columns[mapping.x].label,min:null,max:null};
 next.y={...next.y,label:values.length===1?figureMappingValueName(table,operation,values[0]):'',min:null,max:null};
 if(next.kind==='heatmap'){next.heatmap.valueLabel||=next.y.label;next.y.label=mapping.group===null?heatmapMessages.row:table.columns[mapping.group].label;}
 if(operation==='raw')delete next.summary;else next.summary={operation,rows,category:table.columns[mapping.x].label,group:mapping.group===null?'':table.columns[mapping.group].label,missing};
 if(mapping.xKind!=='number')next.x.scale='linear';if(['bar','bar-horizontal','area'].includes(next.kind))next.y.scale='linear';next.legend=seriesCount>1||figure.legend;return next;
}

// The same mapper serves small file previews and paged retained-dataset jobs.
export function createFigureMapper(table, mapping, figure, {limits={}, median=null,parseNumber=null,provenance=null}={}) {
  let rowCount=0,pointCount=0,textSize=0,limited=false;
  const reserve=(size=0)=>{
    if(++pointCount>(limits.points??Infinity)||(textSize+=size)>(limits.characters??Infinity)){
      limited=true;report(null,null,'The figure has too many points or labels. Summarize rows or choose fewer series.');return false;
    }return true;
  };
  const operation=mapping.operation??'raw';
  const issues = [], warnings = [], series = [], groups = new Map();
  const validColumn = index => Number.isInteger(index) && index >= 0 && index < table.columns.length;
  const report = (row, column, message) => {if(issues.length<20)issues.push({line: row?.line ?? null, column, message});};
  if (!validColumn(mapping.x)) report(null, null, 'Choose the horizontal coordinate column.');
  if (!['number', 'date', 'category'].includes(mapping.xKind)) report(null, mapping.x, 'Choose the horizontal coordinate type.');
  if (!FIGURE_OPERATIONS.some(([id])=>id===operation)) report(null,null,'Choose how to summarize the rows.');
  if (operation!=='count' && !mapping.values.length) report(null, null, 'Choose at least one numeric value column to plot.');
  if (mapping.group !== null && !validColumn(mapping.group)) report(null, null, 'Choose a series grouping column.');
  for (const value of mapping.values) {
    if(value.count!=null&&(!validColumn(value.count)||operation!=='raw'))report(null,null,markerMessages.mapping);
    if(INTERVAL_FIELDS.some(k=>value[k]!=null&&(!validColumn(value[k])||operation!=='raw')))report(null,null,intervalMessages.mapping);
    if (!validColumn(value.column) || value.error !== null && !validColumn(value.error)) report(null, null, 'Choose valid value and uncertainty columns.');
  }
  if(mapping.projection!==undefined&&(!validMeasurementProjection(mapping.projection)||mapping.projection.x&&mapping.xKind!=='number'))report(null,null,'Choose valid exact origin and positive scale settings; horizontal transforms require numeric coordinates.');
  if(mapping.mode==='append'&&(mapping.projection||figure.projection))report(null,null,'A transformed import replaces the figure so every coordinate has the same meaning.');
  if (issues.length) return {add(){},finish:()=>({figure:null,issues,warnings}),get invalid(){return true;}};
  const values=operation==='count'?[{column:null,error:null}]:mapping.values;
  const nameFor=value=>figureMappingValueName(table,operation,value);
  const buckets=new Map();
  let missing=0,bucketCount=0,rounded=false,precision=false,collapsed=false;
  const projectedX=new Map(),exactXValues=new WeakMap(),pointIds=new WeakMap(),seriesInputs=new WeakMap();let nextPoint=0,reduced=false;
  function recordPoint(point,details){if(!provenance)return;const index=nextPoint++;pointIds.set(point,index);provenance.point(index,details);}
  function exactValue(raw,row,column){
    const value=String(raw??'').trim();if(!value)return null;
    try{return exactFigureValue(value,column,{parseNumber,decimal:mapping.decimal});}
    catch(error){if(error.code)throw error;if(error.message==='precision'){precision=true;report(row,column,measurementMessages.summaryPrecision);}else report(row,column,'Expected a number or an empty cell for a gap.');return null;}
  }
  function reduce(operation){
    try{return operation();}catch(error){if(error.message!=='precision')throw error;precision=true;report(null,null,measurementMessages.summaryPrecision);return null;}
  }
  function project(value,row,column,forceSafe=false,details=null){
    if(value===null)return null;
    try{const result=projectFigureValue(value,mapping,{axis:details?.axis??'y',delta:details?.delta??false,forceSafe,transformed:!!details});if(mapping.projection&&details)details.coordinates[details.field]={exact:value,error:result.error};rounded ||= result.rounded;return result.coordinate;}
    catch{precision=true;report(row,column,measurementMessages.plotPrecision);return null;}
  }
  const coordinate=(raw,row,column,forceSafe=false,details=null)=>project(exactValue(raw,row,column),row,column,forceSafe,details);
  function horizontal(value,row,coordinates){
    if(mapping.xKind!=='number')return value;
    const projected=project(value,row,mapping.x,false,{axis:'x',field:'x',coordinates});
    if(projected!==null){if(projectedX.has(projected)&&projectedX.get(projected)!==value)collapsed=true;else projectedX.set(projected,value);}
    return projected;
  }
  const names = new Set(mapping.mode === 'append' ? figure.series.map(s => s.name) : []);
  function seriesFor(value, group) {
    const key = JSON.stringify([value.column, group]);
    if (!groups.has(key)) {
      if(series.length>=(limits.series??Infinity)){limited=true;report(null,null,'Choose fewer series for this figure.');return null;}
      const base = group === null ? nameFor(value) : values.length === 1 ? group : nameFor(value) + ' · ' + group;
      let name = base, suffix = 2;
      while (names.has(name)) name = base + ' (' + suffix++ + ')';
      names.add(name);
      const item = createSeries(name, series.length + (mapping.mode === 'append' ? figure.series.length : 0));
      groups.set(key, item);seriesInputs.set(item,{column:value.column,group});series.push(item);
    }
    return groups.get(key);
  }
  function add(row) {
    if(issues.length)return;
    rowCount++;
    const raw = row.cells[mapping.x].trim(), exactX = mapping.xKind === 'number' ? exactValue(raw,row,mapping.x) : raw;
    const xCoordinates={},x=operation==='raw'?horizontal(exactX,row,xCoordinates):exactX;
    if (mapping.xKind==='number'?exactX===null:xValue(x,mapping.xKind)===null) report(row, mapping.x, 'Enter ' + (mapping.xKind === 'date' ? 'an ISO date (YYYY-MM-DD) or a timestamp with a time zone.' : mapping.xKind === 'number' ? 'a numeric coordinate.' : 'a category.'));
    const group = mapping.group === null ? null : row.cells[mapping.group].trim();
    if (group === '') report(row, mapping.group, 'This row needs a series name, or choose no grouping.');
    for (const value of values) {
      const coordinates={...xCoordinates};
      const y = operation==='count'?'1/1':operation==='raw'?coordinate(row.cells[value.column],row,value.column,false,{axis:'y',field:'y',coordinates}):exactValue(row.cells[value.column],row,value.column);
      const error = operation!=='raw'||value.error === null ? null : coordinate(row.cells[value.error],row,value.error,false,{axis:'y',field:'error',delta:true,coordinates});
      if (operation==='raw' && y !== null && !Number.isFinite(y)) report(row, value.column, 'Expected a number or an empty cell for a gap.');
      if (error !== null && (!Number.isFinite(error) || error < 0)) report(row, value.error, 'Uncertainty must be a non-negative number or an empty cell.');
      if (y === null && error !== null) report(row, value.error, 'Uncertainty needs a measured value in the same row.');
      const item=seriesFor(value, group);
      if(!item)return;
      const intervals={};if(operation==='raw')for(const k of INTERVAL_FIELDS)if(value[k]!=null){const raw=row.cells[value[k]].trim();intervals[k]=!raw?null:k[0]==='x'&&mapping.xKind==='date'?raw:coordinate(raw,row,value[k],false,{axis:k[0],field:k,coordinates});}
      if(operation==='raw'&&value.count!=null){intervals.count=coordinate(row.cells[value.count],row,value.count,true);if(intervals.count!==null&&(!Number.isSafeInteger(intervals.count)||intervals.count<0))report(row,value.count,markerMessages.countInvalid);}
      if(issues.length)return;
      if(operation==='raw'){if(!reserve(String(x).length+item.name.length))return;const point={x,y,error,...intervals};item.points.push(point);exactXValues.set(point,exactX);recordPoint(point,{source:row.source,valueColumn:value.column,group,coordinates});}
      else {
        let categories=buckets.get(item);
        if(!categories){categories=new Map();buckets.set(item,categories);}
        if(!categories.has(x)){
          if(!reserve(String(x).length+item.name.length))return;
          categories.set(x,{key:bucketCount++,n:0,sum:'0/1',min:null,max:null,values:operation==='median'&&!median?[]:null});
        }
        const b=categories.get(x);provenance?.member(b.key,row.source);
        if(y===null)missing++;else{
          b.n++;
          if(operation==='min'&&(b.min===null||compareRationalText(y,b.min)<0))b.min=y;
          if(operation==='max'&&(b.max===null||compareRationalText(y,b.max)>0))b.max=y;
          if(operation==='sum'||operation==='mean'){b.sum=reduce(()=>sumRationalText(b.sum,y));if(issues.length)return;}
          if(operation==='median'){if(median)median.add(b.key,y);else b.values.push(y);}
        }
      }
    }
  }
  function* finishPoints(){
  if(reduced||issues.length)return;reduced=true;
  if(operation!=='raw'){
    for(const [item,categories] of buckets)for(const [x,b] of categories){
      let y=null;
      if(b.n){
        if(operation==='count')y=b.n+'/1';
        else if(operation==='sum')y=b.sum;
        else if(operation==='mean')y=reduce(()=>divideRationalText(b.sum,b.n));
        else if(operation==='min')y=b.min;
        else if(operation==='max')y=b.max;
        else if(median)y=median.value(b.key);
        else {b.values.sort(compareRationalText);const middle=Math.floor(b.n/2);y=b.n%2?b.values[middle]:reduce(()=>sumRationalText(b.values[middle-1],b.values[middle],2n));}
      }
      const coordinates={},point={x:horizontal(x,null,coordinates),y:project(y,null,null,false,{axis:'y',field:'y',coordinates}),error:null};item.points.push(point);exactXValues.set(point,x);
      const {column,group}=seriesInputs.get(item);recordPoint(point,{bucket:b.key,valueColumn:column,group,coordinates});yield point;
    }
    warnings.push(FIGURE_OPERATIONS.find(([id])=>id===operation)[1]+' calculated from '+rowCount+' rows.'+(missing?' '+missing+' empty values excluded; groups with no values stay empty.':''));
  }
  }
  function finish(){
  for(const point of finishPoints()){void point;}
  if (issues.length) return {figure:null,issues,warnings,limited,precision};
  if(rounded)warnings.push(measurementMessages.plotRounded);
  if(collapsed)warnings.push(measurementMessages.plotCollapsed);
  if (mapping.order === 'ascending' && mapping.xKind !== 'category') {
    for (const item of series) item.points.sort((a, b) => mapping.xKind==='number'?compareRationalText(exactXValues.get(a),exactXValues.get(b)):xValue(a.x,mapping.xKind)-xValue(b.x,mapping.xKind));
  }
  let next;
  if(mapping.mode==='append'){
  next = structuredClone(figure);
  next.kind = mapping.kind;
  if(mapping.projection)next.projection=structuredClone(mapping.projection);else if(mapping.mode!=='append')delete next.projection;
  if(mapping.values.some(v=>v.count!=null))next.markerArea??=defaultMarkerArea();else if(mapping.mode!=='append')delete next.markerArea;
  if(next.kind==='heatmap'){next.heatmap??=defaultHeatmap();next.x.scale='linear';next.y.scale='linear';}
  if (mapping.mode === 'append') {
    if (figure.x.kind !== mapping.xKind) report(null, mapping.x, 'Adding series requires the same horizontal coordinate type as the figure.');
    next.series.push(...series);
  } else {
    next.series = series;
    next.x = {...next.x, kind: mapping.xKind, label: table.columns[mapping.x].label, min: null, max: null};
    next.y = {...next.y, label: values.length === 1 ? nameFor(values[0]) : '', min: null, max: null};
  }
  if(next.kind==='heatmap'){next.heatmap.valueLabel||=next.y.label;next.y.label=mapping.group===null?heatmapMessages.row:table.columns[mapping.group].label;}
  if(mapping.mode!=='append'){
    if(operation==='raw')delete next.summary;
    else next.summary={operation,rows:rowCount,category:table.columns[mapping.x].label,group:mapping.group===null?'':table.columns[mapping.group].label,missing};
  } else if(operation!=='raw'||next.summary)report(null,null,'Summary imports replace series so the calculation remains explicit. Use a separate figure to compare different calculations.');
  if (mapping.xKind !== 'number') next.x.scale = 'linear';
  if (['bar', 'bar-horizontal', 'area'].includes(next.kind)) next.y.scale = 'linear';
  next.legend = next.series.length > 1 || figure.legend;
  }else next={...figureMappingPresentation(table,mapping,figure,{seriesCount:series.length,rows:rowCount,missing}),series};
  if (!issues.length) for (const message of figureIssues(next)) report(null, null, message);
  let repeats = 0, backwards = false, gaps = 0;
  for (const item of series) {
    const seen = new Set();
    for (const [i, point] of item.points.entries()) {
      if (point.y === null) gaps++;
      if (seen.has(point.x)) repeats++; else seen.add(point.x);
      if (mapping.xKind !== 'category' && i > 0 && xValue(point.x, mapping.xKind) < xValue(item.points[i - 1].x, mapping.xKind)) backwards = true;
    }
  }
  if (repeats && operation==='raw') warnings.push(repeats + ' repeated coordinates are retained as separate measurements.' + (['bar','bar-horizontal'].includes(next.kind) ? ' Bars at the same coordinate will overlap; use scatter to see individual observations.' : ''));
  if (backwards && ['line', 'area'].includes(next.kind)) warnings.push('Coordinates go backwards in file order. Choose Sort by coordinate to connect them in ascending order, or use scatter.');
  if (gaps) warnings.push(gaps + ' empty values will remain gaps.');
  return {figure: issues.length ? null : next, issues, warnings,limited,precision, measurements: series.reduce((n, s) => n + s.points.filter(p => p.y !== null).length, 0), seriesCount: series.length,...(provenance?{pointOrder:series.map(s=>s.points.map(p=>pointIds.get(p)))}:{})};
  }
  return {add,finish,finishPoints,get invalid(){return !!issues.length;},get stats(){return {rows:rowCount,points:pointCount,series:series.length};}};
}

export function mapFigureTable(table,mapping,figure){
  const mapper=createFigureMapper(table,mapping,figure);
  for(const row of table.rows)mapper.add(row);
  return mapper.finish();
}
