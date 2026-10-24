import {t} from './i18n/index.js';
const message=(key,args)=>t('measurements','sync-'+key,args);
function parts(template,values){return template.split(/(\{\w+\})/).filter(Boolean).flatMap(part=>/^\{\w+\}$/.test(part)?values[part.slice(1,-1)]??part:part);}
// A public descriptor carries interpretation only. Never serialize its source
// locators, encryption/storage references or resource-policy internals.
export function clockSynchronizationContextParts(context,{text=message}={}){
 if(!context)return [];
 if(context.version===2&&context.method==='segmented-piecewise-affine-v1'){
  if(!Number.isSafeInteger(context.segmentCount)||context.segmentCount<1)throw RangeError('Invalid clock synchronization context');
  return parts(text('publicSegmentedContext',{method:'{method}',count:'{count}',source:'{source}',epoch:'{epoch}'}),{method:text('publicSegmentedMethod'),count:String(context.segmentCount),source:context.sourceUnit?' ['+context.sourceUnit+']':'',epoch:context.epoch?text('publicEpoch',{epoch:context.epoch}):''});
 }
 if(context.version!==1||context.method!=='two-anchor-affine'||!context.validity?.lower||!context.validity?.upper)throw RangeError('Invalid clock synchronization context');
 const scalar=value=>parts(text('publicScalar',{spelling:'{spelling}',representation:'{representation}',radix:'{radix}'}),{spelling:{spelling:value.spelling},representation:value.representation,radix:String(value.radix)});
 return parts(text('publicContext',{method:'{method}',lower:'{lower}',upper:'{upper}',source:'{source}',epoch:'{epoch}'}),{method:text('publicMethod'),lower:scalar(context.validity.lower),upper:scalar(context.validity.upper),source:context.sourceUnit?' ['+context.sourceUnit+']':'',epoch:context.epoch?text('publicEpoch',{epoch:context.epoch}):''});
}
export function clockSynchronizationContextText(context,options={}){
 const text=options.text??message;
 return clockSynchronizationContextParts(context,{text}).map(part=>typeof part==='string'?part:typeof part.spelling==='string'?part.spelling:text('publicRetained')).join('');
}
