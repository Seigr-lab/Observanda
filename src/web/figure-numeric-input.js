import {decimalPlotProjection} from './measurement-projection.js';
import {figurePlots} from './figure-composition.js';
import {t} from './i18n/index.js';

// Invalid numeric text stays visible in its field, separate from the last valid
// figure. It cannot be saved or silently converted by changing editor controls.
export function figureNumericInputs({notify}){
 const pending=new Map(),message=()=>t('measurements','plotPrecision');
 const selector=el=>el.hasAttribute('data-axis-tick-field')?`[data-axis-control="${el.closest('[data-axis-control]').dataset.axisControl}"] [data-axis-tick="${el.closest('[data-axis-tick]').dataset.axisTick}"] [data-axis-tick-field="${el.dataset.axisTickField}"]`:el.hasAttribute('data-marker-area')?`[data-marker-area="${el.dataset.markerArea}"]`:el.hasAttribute('data-heatmap-field')?`[data-heatmap-band="${el.closest('[data-heatmap-band]').dataset.heatmapBand}"] [data-heatmap-field="${el.dataset.heatmapField}"]`:el.hasAttribute('data-figure-row')?`[data-figure-row="${el.dataset.figureRow}"][data-figure-column="${el.dataset.figureColumn}"]`:
  el.hasAttribute('data-figure-field')?`[data-figure-field="${el.dataset.figureField}"]`:
  el.hasAttribute('data-annotation-field')?`[data-annotation="${el.closest('[data-annotation]').dataset.annotation}"] [data-annotation-field="${el.dataset.annotationField}"]`:null;
 const numeric=el=>el.type==='number'&&(el.dataset.axisTickField==='value'||el.dataset.markerArea==='unitArea'||el.dataset.heatmapField==='max'||el.hasAttribute('data-figure-row')||['x.min','x.max','y.min','y.max'].includes(el.dataset.figureField)||['start','end','xLower','xUpper','yLower','yUpper','dx','dy'].includes(el.dataset.annotationField));
 const mark=(el,error)=>{el.setCustomValidity(error?message():'');if(error)el.setAttribute('aria-invalid','true');else el.removeAttribute('aria-invalid');};
 const has=figure=>figurePlots(figure).some(f=>pending.has(f.id));
 function input(el,figure){
  if(!numeric(el))return null;
  const key=selector(el);let invalid=false;
  try{decimalPlotProjection(el.value);}catch{invalid=true;}
  if(invalid){const values=pending.get(figure.id)??new Map();values.set(key,el.value);pending.set(figure.id,values);}
  else{const values=pending.get(figure.id);values?.delete(key);if(!values?.size)pending.delete(figure.id);}
  mark(el,invalid);return !invalid;
 }
 function restore(host,figure){
  for(const [key,value] of pending.get(figure.id)??[]){const el=host.querySelector(key);if(el){el.value=value;mark(el,true);}}
 }
 function blocked(){if(!pending.size)return false;notify(message(),true);document.querySelector('[data-figure-id] [aria-invalid="true"]')?.focus();return true;}
 return {input,restore,has,numeric,blocked,issue:figure=>has(figure)?message():null,validate(){if(pending.size)throw Error(message());},clear(){pending.clear();}};
}
