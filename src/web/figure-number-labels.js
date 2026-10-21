import {figureStyle} from './figure-style.js';
import {figureRadixLabel,figureRadixPrecision,figureRadixValue} from './figure-radix-labels.js';
// Axis precision is derived from the displayed ticks, independently of retained
// measurements and the author's explicit decimal-place setting.
export function formatFigureNumber(value,style,precision=null){
 value=Object.is(value,-0)?0:value;
 if(style.numberFormat==='radix')return figureRadixLabel(value,style.radix,precision??6);
 if(style.numberFormat==='scientific')return value.toExponential(style.decimals??precision??2);
 if(style.numberFormat==='percent'){
  const percent=value*100;
  if(style.decimals===null&&percent!==0&&(Math.abs(percent)>=1e9||Math.abs(percent)<1e-5))
   return percent.toExponential((precision??5)-1).replace(/\.?0+e/,'e')+'%';
  return percent.toLocaleString('en',{minimumFractionDigits:style.decimals??0,maximumFractionDigits:style.decimals??precision??2})+'%';
 }
 if(style.decimals!==null)return value.toLocaleString('en',{minimumFractionDigits:style.decimals,maximumFractionDigits:style.decimals,useGrouping:style.numberFormat!=='decimal'});
 const digits=precision??5;
 if(style.numberFormat==='auto'&&value!==0&&(Math.abs(value)>=1e9||Math.abs(value)<1e-5))return value.toExponential(digits-1).replace(/\.?0+e/,'e');
 return Number(value.toPrecision(digits)).toLocaleString('en',{maximumSignificantDigits:digits,useGrouping:style.numberFormat!=='decimal'});
}
export function figureTickLabels(values,style){
 let labels=values.map(value=>formatFigureNumber(value,style));
 if(style.decimals!==null&&style.numberFormat!=='radix')return labels;
 const distinct=new Set(values).size;
 for(let precision=style.numberFormat==='scientific'||style.numberFormat==='percent'?3:6;new Set(labels).size<distinct&&precision<=(style.numberFormat==='radix'?figureRadixPrecision(style.radix):17);precision++)labels=values.map(value=>formatFigureNumber(value,style,precision));
 return labels;
}

// Data tables and point hints preserve all significant digits of the plot value.
export const figureDataNumber=(value,style)=>style.numberFormat==='radix'?figureRadixValue(value,style.radix):String(value);
export const figureCoordinateNumber=(figure,axis,value)=>value==null?'':axis==='x'&&figure.x.kind!=='number'?String(value):figureDataNumber(value,figureStyle(figure));
