import {FIGURE_TYPES} from './figure-model.js';
import {INTERVAL_FIELDS} from './figure-intervals.js';
import {t} from './i18n/index.js';
const text=key=>t('retainedFigureEditor',key);
const property=(path,type='number',options)=>({path,type,label:'point.'+path,options});
export function authoredFigureProperties(part,value,header){
 if(part==='points')return value?['x','y','error',...INTERVAL_FIELDS,'count'].map(key=>property(key,key==='x'&&header.x.kind!=='number'?'text':key.startsWith('x')&&header.x.kind==='date'?'string':'number')):[];
 if(['figure','plot'].includes(part)&&value?.kind!=='panels')return [{path:'kind',type:'choice',label:'kind',options:FIGURE_TYPES.map(([kind])=>kind)},{path:'x.kind',type:'choice',label:'x.kind',options:['number','date','category']},...(['line','scatter'].includes(value.kind)||value.markerArea?[{path:'markerArea',type:'boolean',label:'markerArea.enabled'}]:[])];
 return [];
}
export function authoredFigureAddition(part,{plotId,seriesId}){
 if(part==='points')return {type:'append',collection:'points',plotId,seriesId,value:{x:null,y:null,error:null}};
 if(part==='series')return {type:'append',collection:'series',plotId,value:{name:text('newSeries'),color:'#4f86c6'}};
 if(part==='panels')return {type:'append',collection:'panels',value:{label:text('newPanel'),kind:'line',xKind:'number'}};
 return null;
}
