import {figureStyle} from './figure-style.js';
import {figureRadixLabel,figureRadixPrecision,figureRadixValue} from './figure-radix-labels.js';
import {notationNumber,numberSymbols,typographicExponent} from './figure-number-notation.js';
// Axis precision is derived from the displayed ticks, independently of retained
// measurements and the author's explicit decimal-place or significant-digit
// setting. `style.locale` is the reader's language, set by the renderer.
export function formatFigureNumber(value,style,precision=null){
 value=Object.is(value,-0)?0:value;
 const locale=numberSymbols(style.locale??'en').locale,chosen=style.decimals===null?style.significantDigits??null:null;
 if(style.numberFormat==='radix')return figureRadixLabel(value,style.radix,precision??6);
 if(['engineering','si'].includes(style.numberFormat))return notationNumber(value,{notation:style.numberFormat,digits:chosen??precision??3,decimals:style.decimals,locale,keepZeros:chosen!==null});
 if(style.numberFormat==='scientific')return typographicExponent(chosen!==null?value.toExponential(chosen-1):value.toExponential(style.decimals??precision??2),locale);
 if(style.numberFormat==='percent'){
  const percent=value*100;
  if(style.decimals===null&&percent!==0&&(Math.abs(percent)>=1e9||Math.abs(percent)<1e-5))
   return percent.toExponential((chosen??precision??5)-1).replace(/\.?0+e/,'e')+'%';
  return percent.toLocaleString(locale,chosen!==null?{minimumSignificantDigits:chosen,maximumSignificantDigits:chosen}:{minimumFractionDigits:style.decimals??0,maximumFractionDigits:style.decimals??precision??2})+'%';
 }
 if(style.decimals!==null)return value.toLocaleString(locale,{minimumFractionDigits:style.decimals,maximumFractionDigits:style.decimals,useGrouping:style.numberFormat!=='decimal'});
 const digits=chosen??precision??5;
 if(style.numberFormat==='auto'&&value!==0&&(Math.abs(value)>=1e9||Math.abs(value)<1e-5))return typographicExponent(chosen!==null?value.toExponential(digits-1):value.toExponential(digits-1).replace(/\.?0+e/,'e'),locale);
 return Number(value.toPrecision(digits)).toLocaleString(locale,{maximumSignificantDigits:digits,...(chosen!==null?{minimumSignificantDigits:digits}:{}),useGrouping:style.numberFormat!=='decimal'});
}
export function figureTickLabels(values,style){
 let labels=values.map(value=>formatFigureNumber(value,style));
 if((style.decimals!==null||style.significantDigits!=null)&&style.numberFormat!=='radix')return labels;
 const distinct=new Set(values).size;
 for(let precision=['scientific','engineering','si','percent'].includes(style.numberFormat)?3:6;new Set(labels).size<distinct&&precision<=(style.numberFormat==='radix'?figureRadixPrecision(style.radix):17);precision++)labels=values.map(value=>formatFigureNumber(value,style,precision));
 return labels;
}

// Data tables and point hints preserve all significant digits of the plot value.
export const figureDataNumber=(value,style)=>style.numberFormat==='radix'?figureRadixValue(value,style.radix):String(value);
export const figureCoordinateNumber=(figure,axis,value)=>value==null?'':axis==='x'&&figure.x.kind!=='number'?String(value):figureDataNumber(value,figureStyle(figure));
