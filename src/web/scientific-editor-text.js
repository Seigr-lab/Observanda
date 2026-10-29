import {t} from './i18n/index.js';
import './i18n/catalogues/scientificEditors.js';
export const scientificText=(key,parameters)=>t('scientificEditors',key,parameters);
const st=scientificText;
export const figureTypeOptions=items=>{const labels={"line":t("retainedFigureEditor","option_line"),"scatter":t("retainedFigureEditor","option_scatter"),"bar":t("retainedFigureEditor","option_bar"),"bar-horizontal":t("retainedFigureEditor","option_bar-horizontal"),"area":t("retainedFigureEditor","option_area"),"heatmap":t("figureHeatmap","kind")};return items.map(([id])=>[id,labels[id]]);};
export const figureFontOptions=items=>{const labels={"sans":t("retainedFigureEditor","option_sans"),"serif":t("retainedFigureEditor","option_serif"),"mono":t("retainedFigureEditor","option_mono")};return items.map(([id])=>[id,labels[id]]);};
export const figureOperationOptions=items=>{const labels={"raw":st("individualMeasurements"),"count":st("countRows"),"mean":t("datasetAggregation","mean"),"median":t("datasetAggregation","median"),"sum":t("datasetAggregation","sum"),"min":t("datasetAggregation","min"),"max":t("datasetAggregation","max")};return items.map(([id])=>[id,labels[id]]);};
export const tableDelimiterOptions=items=>{const labels={"auto":st("delimiterAutomatic"),",":st("delimiterComma"),"\t":st("delimiterTab"),";":st("delimiterSemicolon"),"|":st("delimiterPipe")};return items.map(([id])=>[id,labels[id]]);};
export const graphKindText=kind=>({"column":t("datasetAggregation","column"),"constant":t("datasetCalculations","constant"),"scalar":st("graphKind-scalar"),"comparison":st("graphKind-comparison"),"boolean":st("graphKind-boolean"),"domain":st("graphKind-domain"),"clock":st("graphKind-clock"),"interval":st("graphKind-interval"),"window":st("graphKind-window"),"clock-synchronize":st("graphKind-clock-synchronize"),"domain-arithmetic":st("graphKind-domain-arithmetic"),"domain-reshape":st("graphKind-domain-reshape"),"domain-permute":st("graphKind-domain-permute"),"coordinate-transform":st("graphKind-coordinate-transform"),"domain-sequence":st("graphKind-domain-sequence"),"domain-topology":st("graphKind-domain-topology")})[kind]??kind;
export const graphCollectionText=kind=>({"bindings":st("graphCollection-bindings"),"nodes":st("graphCollection-nodes"),"outputs":st("graphCollection-outputs"),"edges":st("graphCollection-edges"),"columns":st("graphCollection-columns")})[kind]??kind;
export function graphOptionText(field,value,kind){
 if(field==='view'||field==='unmatched')return t('datasetCalculations',value);
 if(field==='semantics')return value==='domain'?st("domainMatch"):t('datasetCalculations','key-'+value);
 if(field==='representation')return t('measurements',value==='radix'?'radixLabel':value);
 if(field==='outside')return value==='absent'?t('measurements','absent'):st("stopError");
 if(field==='operator')return t('datasetCalculations',['and','or','not'].includes(value)?'condition-'+value:value);
 if(field==='operation'){
  if(kind==='clock')return t('measurements','transition-'+value);
  if(kind==='window')return t('datasetWindows',value);
  if(kind==='domain-arithmetic')return t('datasetCalculations','algebra-'+value);
  if(kind==='clock-synchronize')return value==='value'?t('measurements','value'):st("status");
  if(kind==='domain')return ({copy:st("domainCopy"),choose:st("domainChoose"),extract:st("domainExtract")})[value];
  if(kind==='interval'&&['bounds','lower','upper'].includes(value))return ({bounds:st("intervalBounds"),lower:st("intervalLower"),upper:st("intervalUpper")})[value];
  return t('datasetCalculations',value);
 }
 return value;
}
