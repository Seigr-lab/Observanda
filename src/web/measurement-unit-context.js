import {t} from './i18n/index.js';
import {validUnitDefinition} from './measurement-unit-model.js';
const message=(key,args)=>t('measurements',key,args);
// Public unit meaning contains declared dimensions and exact coordinates only.
// Scalar fragments can be streamed without serializing their private locators.
export function measurementUnitContextParts(definition,{text=message}={}){
 if(!definition)return [];
 if(!validUnitDefinition(definition))throw RangeError('Invalid declared unit context');
 const scalar=value=>[{spelling:value.spelling},text('unitPublicScalar',{representation:value.representation,radix:value.radix})];
 const values={kind:text('unit-'+definition.kind),dimensions:definition.dimensions.map(d=>d.axis+'^'+d.exponent).join(' * ')||text('dimensionless'),scale:scalar(definition.scale),offset:scalar(definition.offset)};
 return text('unitPublicContext',{kind:'{kind}',dimensions:'{dimensions}',scale:'{scale}',offset:'{offset}'}).split(/(\{\w+\})/).filter(Boolean).flatMap(part=>/^\{\w+\}$/.test(part)?values[part.slice(1,-1)]??part:part);
}
export function measurementUnitContextText(definition,{text=message}={}){
 return measurementUnitContextParts(definition,{text}).map(part=>typeof part==='string'?part:typeof part.spelling==='string'?part.spelling:text('unitPublicRetained')).join('');
}
