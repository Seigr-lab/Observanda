import {figureDiagnosticText,figureResourceIssue} from './figure-diagnostics.js';
import {validComputation} from './measurement-computation.js';
import {isRetainedFigure,validRetainedFigure} from './retained-figure-model.js';
import {validMeasurementProjection} from './measurement-transform.js';
import projectionMessages from './locales/en/measurementTransform.json' with {type:'json'};
import {axisControlIssues} from './figure-axis-controls.js';
import {richFigureCSV} from './figure-rich-export.js';
import {markerAreaIssues} from './figure-marker-area.js';
import markerMessages from './locales/en/figureMarkerArea.json' with {type:'json'};
import {INTERVAL_FIELDS,intervalIssues} from './figure-intervals.js';
import intervalMessages from './locales/en/figureIntervals.json' with {type:'json'};
import {heatmapIssues} from './figure-heatmap.js';
import {heatmapCSV} from './figure-heatmap-export.js';
import heatmapMessages from './locales/en/figureHeatmap.json' with {type:'json'};
import {validFigureStyle,validSeriesStyle} from './figure-style.js';
import {readDelimitedTable, tableNumber} from './tabular-data.js';
import {annotationIssues} from './figure-annotations.js';
import {compositionIssues,figurePlots} from './figure-composition.js';
import compositionMessages from './locales/en/figureComposition.json' with {type:'json'};
import provenanceMessages from './locales/en/figureProvenance.json' with {type:'json'};
import {validFigureSource} from './figure-provenance.js';
import {decimalPlotProjection} from './measurement-projection.js';

// Portable figure data, shared by persistence, editing, dashboards and export.
const keys=(o,names)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===names.length&&names.every(k=>Object.hasOwn(o,k));
const text=v=>typeof v==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e100;
const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const FIGURE_TYPES=[['line','Line'],['scatter','Scatter'],['bar','Vertical bars'],['bar-horizontal','Horizontal bars'],['area','Area'],['heatmap',heatmapMessages.kind]];
export const SERIES_COLORS=['#3b5bbd','#147d75','#a86120','#92549f','#a13b59','#536878'];
export const createSeries=(name='Series 1',index=0)=>({id:crypto.randomUUID(),name,color:SERIES_COLORS[index%SERIES_COLORS.length],points:[]});
export const createFigure=()=>({id:crypto.randomUUID(),title:'Data figure',kind:'line',x:{kind:'number',label:'',scale:'linear',min:null,max:null},y:{label:'',scale:'linear',min:null,max:null},legend:true,series:[createSeries()]});
export function upgradeFigure(chart,id){
 return {id,title:chart.title,kind:chart.kind,x:{kind:'category',label:chart.xLabel,scale:'linear',min:null,max:null},y:{label:chart.yLabel,scale:'linear',min:null,max:null},legend:false,series:[{id,name:chart.yLabel||'Values',color:SERIES_COLORS[0],points:chart.points.map(p=>({x:p.label,y:p.value,error:null}))}]};
}
export function xValue(value,kind){
 if(kind==='category')return text(value)&&value.trim()?value:null;
 if(kind==='number')return number(value)?value:null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))return null;
 const date=value.slice(0,10),day=Date.parse(date);
 if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==date)return null;
 const stamp=Date.parse(value);return Number.isFinite(stamp)?stamp:null;
}
export function figureIssues(figure,options={}){return figureIssuesRaw(figure,options).map(message=>figureResourceIssue(message,options.translate));}
function figureIssuesRaw(figure,{draft=false,retained=false,resourceErrors=false,translate}={}){
 const fm=figureDiagnosticText(translate);
 if(isRetainedFigure(figure))return validRetainedFigure(figure,{draft})?[]:[fm('retainedInvalid')];
 if(Object.hasOwn(figure??{},'source')&&!validFigureSource(figure.source))return [provenanceMessages.invalid];
 if(figure?.kind==='panels')return compositionIssues(figure,figureIssues,{draft,retained,resourceErrors,translate});
 const errors=[];
 const fail=message=>errors.push(message);
 if(!keys(figure,['id','title','kind','x','y','legend','series',...['style','summary','annotations','source','heatmap','markerArea','projection','computation'].filter(k=>Object.hasOwn(figure??{},k))]))return [fm('structureInvalid')];
 if(Object.hasOwn(figure,'computation')&&(!validComputation(figure.computation)||figure.computation.kind!=='approximate-inputs'))fail(fm('structureInvalid'));
 if(Object.hasOwn(figure,'projection')&&(!validMeasurementProjection(figure.projection,{resourceErrors})||figure.projection?.x&&figure.x?.kind!=='number'))fail(projectionMessages.invalid);
 if(Object.hasOwn(figure,'style')&&!validFigureStyle(figure.style))fail(fm('styleInvalid'));
 if(Object.hasOwn(figure,'summary')&&(!keys(figure.summary,['operation','rows','category','group','missing'])||!['count','sum','mean','median','min','max'].includes(figure.summary.operation)||!Number.isInteger(figure.summary.rows)||figure.summary.rows<1||!text(figure.summary.category)||!text(figure.summary.group)||!Number.isInteger(figure.summary.missing)||figure.summary.missing<0))fail(fm('summaryInvalid'));
 if(!id(figure.id)||!text(figure.title)||!draft&&!figure.title.trim())fail(fm('titleRequired'));
 if(!FIGURE_TYPES.some(([kind])=>kind===figure.kind))fail(fm('kindRequired'));
 for(const [name,axis] of [['Horizontal',figure.x],['Vertical',figure.y]]){
  if(!keys(axis,[...(name==='Horizontal'?['kind','label','scale','min','max']:['label','scale','min','max']),...['reversed','ticks'].filter(k=>Object.hasOwn(axis??{},k))])||!text(axis.label)||!['linear','log'].includes(axis.scale)||![axis.min,axis.max].every(v=>v===null||number(v)))return [fm('axisInvalid')];
  errors.push(...axisControlIssues(axis,{draft,retained,kind:axis.kind??'number'}));
  if(!draft&&axis.min!==null&&axis.max!==null&&axis.min>=axis.max)fail(fm('axisMinimum',{axis:fm(name==='Horizontal'?'horizontal':'vertical')}));
  if(!draft&&axis.scale==='log'&&[axis.min,axis.max].some(v=>v!==null&&v<=0))fail(fm('axisPositive',{axis:fm(name==='Horizontal'?'horizontal':'vertical')}));
 }
 if(figure.x.kind==='date'&&[figure.x.min,figure.x.max].some(v=>v!==null&&Math.abs(v)>8.64e15))fail(fm('calendarBounds'));
 if(!['category','number','date'].includes(figure.x.kind))fail(fm('horizontalType'));
 if(!draft&&figure.x.kind!=='number'&&figure.x.scale!=='linear')fail(fm('numericLog'));
 if(!draft&&figure.kind==='scatter'&&figure.x.kind==='category')fail(fm('scatterCoordinates'));
 if(!draft&&['bar','bar-horizontal','area'].includes(figure.kind)&&figure.y.scale==='log')fail(fm('linearBars'));
 if(typeof figure.legend!=='boolean'||!Array.isArray(figure.series)||!figure.series.length)return [...errors,fm('seriesRequired')];
 const ids=new Set(),names=new Set();
 for(const series of figure.series){
  if(!keys(series,['id','name','color','points',...(Object.hasOwn(series??{},'style')?['style']:[])])||!id(series.id)||ids.has(series.id)||!text(series.name)||!/^#[0-9a-f]{6}$/i.test(series.color)||!Array.isArray(series.points))return [...errors,fm('seriesInvalid')];
  if(Object.hasOwn(series,'style')&&!validSeriesStyle(series.style))fail(fm('seriesStyle'));
  ids.add(series.id);if(!draft&&names.has(series.name))fail(fm('seriesDistinct'));names.add(series.name);if(!draft&&!series.name.trim())fail(fm('seriesName'));
  let complete=0;
  for(const [i,p] of series.points.entries()){
   if(!keys(p,['x','y','error',...[...INTERVAL_FIELDS,'count'].filter(k=>Object.hasOwn(p??{},k))])||!(p.x===null||text(p.x)||number(p.x))||!(p.y===null||number(p.y))||!(p.error===null||number(p.error)&&p.error>=0))return [...errors,fm('pointInvalid',{series:series.name,row:i+1})];
   errors.push(...intervalIssues(p,figure,xValue,{draft}));
   if(draft)continue;
   const x=xValue(p.x,figure.x.kind);
   if(x===null)fail(fm('pointCoordinate',{series:series.name,row:i+1}));
   if(p.y!==null){
    complete++;
    if(figure.y.scale==='log'&&p.y-(p.error??0)<=0)fail(fm('pointLogValue',{series:series.name,row:i+1}));
   }
   if(figure.x.scale==='log'&&x<=0)fail(fm('pointLogCoordinate',{series:series.name,row:i+1}));
  }
  if(!draft&&!complete&&figure.kind!=='heatmap')fail(fm('seriesMeasured',{series:series.name}));
 }
 return [...new Set([...errors,...markerAreaIssues(figure,{draft,retained}),...heatmapIssues(figure,{draft,retained}),...annotationIssues(figure,xValue,{draft,retained})])];
}
export const validFigure=(figure,options)=>figureIssues(figure,options).length===0;
export function parseFigureCSV(source,kind='number',{translate}={}){
 const fm=figureDiagnosticText(translate);
 const coordinate=value=>{
  const parsed=tableNumber(value);if(parsed===null||!Number.isFinite(parsed))return parsed;
  try{return decimalPlotProjection(value);}catch{return NaN;}
 };
 const table=readDelimitedTable(source,{translate});
 const header=table.columns.map(column=>column.label),rows=table.rows.map(row=>row.cells);
 if(header.length===4&&header[0]==='Series'&&header[3]==='Uncertainty'){
  const series=[];
  for(const [i,row] of rows.entries()){
   if(row.length!==4||!row[0].trim())throw new Error(fm('csvSeries',{row:i+2}));
   const x=kind==='number'?(row[1].trim()?coordinate(row[1]):null):row[1],y=row[2].trim()?coordinate(row[2]):null,error=row[3].trim()?coordinate(row[3]):null;
   if(xValue(x,kind)===null||y!==null&&!number(y)||error!==null&&(!number(error)||error<0))throw new Error(fm('csvMeasurement',{row:i+2}));
   let item=series.find(s=>s.name===row[0]);if(!item){item=createSeries(row[0],series.length);series.push(item);}
   item.points.push({x,y,error});
  }
  return {xLabel:header[1],yLabel:header[2],series};
 }
 if(new Set(header.slice(1)).size!==header.length-1)throw new Error(fm('seriesDistinct'));
 const series=header.slice(1).map((name,i)=>createSeries(name,i));
 for(const [i,row] of rows.entries()){
  if(row.length!==header.length)throw new Error(fm('csvColumns',{row:i+2}));
  const raw=row[0].trim(),x=kind==='number'?(raw?coordinate(raw):null):raw;
  if(xValue(x,kind)===null)throw new Error(fm('csvCoordinate',{row:i+2}));
  for(let j=1;j<row.length;j++){
   const value=row[j].trim(),y=value?coordinate(value):null;
   if(y!==null&&!number(y))throw new Error(fm('csvGap',{row:i+2,column:header[j]}));
   series[j-1].points.push({x,y,error:null});
  }
 }
 return {xLabel:header[0],series};
}
export function figureCSV(figure){
 if(figurePlots(figure).some(f=>f.computation||f.projection||f.x.reversed||f.y.reversed||f.x.ticks?.length||f.y.ticks?.length||f.annotations?.some(a=>['region','callout'].includes(a.kind))))return richFigureCSV(figure);
 if(figurePlots(figure).some(f=>f.kind==='heatmap'))return heatmapCSV(figure);
 const extra=figurePlots(figure).some(f=>f.series.some(s=>s.points.some(p=>INTERVAL_FIELDS.some(k=>p[k]!=null))))?INTERVAL_FIELDS:[];
 const counted=figurePlots(figure).some(f=>f.markerArea||f.series.some(s=>s.points.some(p=>p.count!=null))),countHeaders=counted?[markerMessages.count,markerMessages.unitArea,markerMessages.label]:[],countCells=(p,f)=>counted?[p.count??null,f.markerArea?.unitArea??null,f.markerArea?.label??'']:[];
 const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
 if(figure.kind==='panels'||figure.annotations?.length){
  const m=compositionMessages,rows=[[m.panelData,m.dataKind,m.series,m.x,m.y,m.uncertainty,m.axis,m.start,m.end,m.plotTitle,m.coordinateLabel,m.valueLabel,...extra.map(k=>intervalMessages[k]),...countHeaders]];
  figurePlots(figure).forEach((plot,i)=>{
   const panel=figure.kind==='panels'?figure.panels[i].label:figure.title;
   for(const s of plot.series)for(const p of s.points)rows.push([panel,m.measurement,s.name,p.x,p.y,p.error,'','','',plot.title,plot.x.label,plot.y.label,...extra.map(k=>p[k]??null),...countCells(p,plot)]);
   for(const a of plot.annotations??[])rows.push([panel,m[a.kind],a.label,'','','',a.axis,a.start,a.end,plot.title,plot.x.label,plot.y.label]);
  });
  return rows.map(row=>Array.from({length:rows[0].length},(_,i)=>row[i]??'').map(quote).join(',')).join('\r\n')+'\r\n';
 }
 const rows=[['Series',figure.x.label||'X',figure.y.label||'Value','Uncertainty',...extra.map(k=>intervalMessages[k]),...countHeaders]];
 for(const series of figure.series)for(const p of series.points)rows.push([series.name,p.x,p.y,p.error,...extra.map(k=>p[k]??null),...countCells(p,figure)]);
 return rows.map(row=>Array.from({length:rows[0].length},(_,i)=>row[i]??'').map(quote).join(',')).join('\r\n')+'\r\n';
}
