import {exactRational} from './measurement-model.js';
import {NUMBER_REPRESENTATIONS,numeralUsesRadix,validNumeralContext} from './numeral-context.js';

// An omitted context is the historical decimal interpretation. Context belongs
// to each saved field definition, never to a workspace-wide display preference.
export const FIELD_NUMBER_REPRESENTATIONS=NUMBER_REPRESENTATIONS;
export const fieldNumberContext=field=>field.numeric??{version:1,representation:'decimal',radix:10};
export const fieldNumberUsesRadix=numeralUsesRadix;
export const validFieldNumberContext=validNumeralContext;
export function validFieldNumber(field,value){
 const context=fieldNumberContext(field);if(!validFieldNumberContext(context))return false;
 try{exactRational(value,context.representation,context.radix);return true;}catch{return false;}
}

// Shared schema editor mutation; only schema controls may change interpretation.
// Record values themselves always remain exactly as entered.
export function setCustomFieldProperty(field,key,value){
 if(!field)return false;
 if(key==='numericRepresentation'){
  if(field.type!=='number'||!FIELD_NUMBER_REPRESENTATIONS.includes(value))return false;
  const before=fieldNumberContext(field);
  field.numeric={version:1,representation:value,radix:fieldNumberUsesRadix(value)?before.radix:10};
 }else if(key==='numericRadix'){
  if(field.type!=='number'||!fieldNumberUsesRadix(fieldNumberContext(field).representation))return false;
  field.numeric={...fieldNumberContext(field),radix:Number(value)};
 }else if(key==='type'){
  if(!['text','number','boolean','date','select'].includes(value))return false;
  field.type=value;
  if(value==='number')field.numeric={...fieldNumberContext(field)};else delete field.numeric;
 }else if(['label','unit','required','choices'].includes(key))field[key]=value;
 else return false;
 return true;
}
