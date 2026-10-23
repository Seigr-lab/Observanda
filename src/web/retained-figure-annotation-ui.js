import {t} from './i18n/index.js';
import {escapeFigureText as esc} from './retained-figure-text.js';
import {annotationIssues} from './figure-annotations.js';
import {xValue} from './figure-model.js';
const annotation=(key)=>t('figureComposition',key),observation=(key)=>t('figureObservations',key),heatmap=(key)=>t('figureHeatmap',key);
const field=(label,control)=>'<label class="field">'+esc(label)+control+'</label>';
const input=(key,label,value='',{type='text',attrs=''}={})=>field(label,'<input data-fe-value data-fe-key="'+key+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'>');
const numeric=(key,label,value='',attrs='')=>input(key,label,value,{type:'number',attrs:'step="any" required '+attrs});
const get=(root,key)=>root.querySelector('[data-fe-key="'+key+'"]');
const read=(root,key)=>get(root,key).value;
const number=(root,key)=>{const value=read(root,key);if(!value.trim()||!Number.isFinite(Number(value)))throw Error(annotation('annotationInvalid'));return Number(value);};
const validate=root=>{for(const node of root.querySelectorAll('[data-fe-value]'))if(!node.reportValidity())throw Error(annotation('annotationInvalid'));};
export function retainedCalloutTargetControls({seriesPosition=0,pointPosition=0}={}){
 return numeric('seriesPosition',observation('series'),seriesPosition+1,'min="1" step="1"')+numeric('pointPosition',observation('pointIndex'),pointPosition+1,'min="1" step="1"');
}
export async function readRetainedCalloutTarget(root,{plotId,call}){
 const seriesPosition=number(root,'seriesPosition')-1,pointPosition=number(root,'pointPosition')-1;
 if(![seriesPosition,pointPosition].every(value=>Number.isSafeInteger(value)&&value>=0))throw Error(observation('calloutRange'));
 const series=(await call('window',{selection:{collection:'series',plotId,offset:seriesPosition,limit:1}})).items[0];
 if(!series||series.plotId!==plotId)throw Error(observation('calloutRange'));
 const point=(await call('window',{selection:{collection:'points',plotId,seriesId:series.id,offset:pointPosition,limit:1}})).items[0];
 if(!point||point.plotId!==plotId||point.seriesId!==series.id||point.position!==pointPosition||point.value.y===null)throw Error(observation('calloutRange'));
 return {seriesId:series.id,pointIndex:point.position,point:point.value};
}
export function retainedAnnotationCreation(header){
 const kinds=['boundary','interval',...(header.x.kind==='category'?[]:['region']),'callout'];
 return '<div data-fe-create>'+field(annotation('dataKind'),'<select data-fe-value data-fe-key="kind">'+kinds.map(kind=>'<option value="'+kind+'">'+esc(['region','callout'].includes(kind)?observation(kind):annotation(kind))+'</option>').join('')+'</select>')+
  input('label',annotation('annotationLabel'),'',{attrs:'required maxlength="16384"'})+
  '<fieldset data-fe-group="axis">'+field(annotation('axis'),'<select data-fe-value data-fe-key="axis">'+(header.x.kind==='category'?'':'<option value="x">'+esc(annotation('coordinate'))+'</option>')+'<option value="y" selected>'+esc(annotation('value'))+'</option></select>')+input('start',annotation('start'),'',{attrs:'required'})+'<span data-fe-end>'+input('end',annotation('end'),'',{attrs:'required'})+'</span></fieldset>'+
  '<fieldset data-fe-group="region">'+['xLower','xUpper','yLower','yUpper'].map(key=>input(key,observation(key),'',{attrs:'required'})).join('')+'</fieldset>'+
  '<fieldset data-fe-group="callout">'+retainedCalloutTargetControls()+numeric('dx',observation('dx'),24,'min="-2000" max="2000"')+numeric('dy',observation('dy'),-36,'min="-2000" max="2000"')+'</fieldset>'+
  input('color',annotation('color'),'#92549f',{type:'color'})+numeric('opacity',annotation('opacity'),.15,'min="0" max="1"')+'</div>';
}
export function updateRetainedAnnotationCreation(root,header){
 const host=root.querySelector('[data-fe-create]');if(!host)return;const kind=read(host,'kind'),axis=read(host,'axis');
 for(const node of host.querySelectorAll('[data-fe-group]')){const active=node.dataset.feGroup===(['boundary','interval'].includes(kind)?'axis':kind);node.hidden=!active;node.disabled=!active;}
 const end=host.querySelector('[data-fe-end]');end.hidden=kind!=='interval';get(host,'end').disabled=kind!=='interval';
 for(const key of ['start','end','xLower','xUpper','yLower','yUpper']){const date=header.x.kind==='date'&&(key.startsWith('x')||['start','end'].includes(key)&&axis==='x'),node=get(host,key);node.type=date?'text':'number';if(!date)node.step='any';}
}
export async function readRetainedAnnotation(root,{id,header,plotId,call}){
 const host=root.querySelector('[data-fe-create]');validate(host);const kind=read(host,'kind'),common={id,kind,label:read(host,'label'),color:read(host,'color'),opacity:number(host,'opacity')};let value,series=[];
 if(kind==='callout'){const target=await readRetainedCalloutTarget(host,{plotId,call});value={...common,seriesId:target.seriesId,pointIndex:target.pointIndex,dx:number(host,'dx'),dy:number(host,'dy')};series=[{id:target.seriesId,points:[target.point]}];}
 else if(kind==='region'){value={...common};for(const key of ['xLower','xUpper','yLower','yUpper'])value[key]=key.startsWith('x')&&header.x.kind==='date'?read(host,key):number(host,key);}
 else {const axis=read(host,'axis'),date=axis==='x'&&header.x.kind==='date';value={...common,axis,start:date?read(host,'start'):number(host,'start'),end:kind==='boundary'?null:date?read(host,'end'):number(host,'end')};}
 const checked=kind==='callout'?{...value,pointIndex:0}:value,issues=annotationIssues({...header,series,annotations:[checked]},xValue,{retained:true});if(issues.length)throw Error(issues[0]);return value;
}
export function retainedThresholdProperties(header,position){
 const thresholds=header.heatmap.thresholds;if(!thresholds[position]||thresholds.length>32)throw Error(heatmap('invalid'));
 return [{path:'label',type:'text',label:'label'},{path:'color',type:'color',label:'color'},...(position===thresholds.length-1?[]:[{path:'max',type:'number',label:'thresholdMax'}])];
}
export function retainedThresholdScalar(header,index,field,value){
 const bands=header.heatmap.thresholds;if(!bands[index]||bands.length>32)throw Error(heatmap('invalid'));
 if(field==='color'){if(typeof value!=='string'||!/^#[a-f0-9]{6}$/i.test(value))throw Error(heatmap('invalid'));}
 else if(field!=='max'||index===bands.length-1||!Number.isFinite(value)||Math.abs(value)>1e100||index>0&&value<=bands[index-1].max||bands[index+1].max!==null&&value>=bands[index+1].max)throw Error(heatmap('invalid'));
 return {type:'threshold',collection:'header',id:header.id,plotId:header.id,index,patch:{[field]:value}};
}
