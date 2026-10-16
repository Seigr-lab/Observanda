
import {validFieldNumberContext,validFieldNumber} from './custom-field-numbers.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const unique=items=>new Set(items).size===items.length;
export const fieldChoiceValid=value=>text(value,160,true);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export const validFields=fields=>Array.isArray(fields)&&unique(fields.map(f=>f?.key))&&fields.every(f=>exact(f,['key','label','type','unit','required','choices',...(f&&Object.hasOwn(f,'numeric')?['numeric']:[])])&&(!Object.hasOwn(f,'numeric')||f.type==='number'&&validFieldNumberContext(f.numeric))&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(f.key)&&!['__proto__','constructor','prototype'].includes(f.key)&&text(f.label,160,true)&&['text','number','boolean','date','select'].includes(f.type)&&text(f.unit,80)&&typeof f.required==='boolean'&&Array.isArray(f.choices)&&f.choices.every(fieldChoiceValid)&&unique(f.choices)&&(f.type!=='select'||f.choices.length>0));
export function fieldValueErrors(fields,values,{draft=false,label=field=>field.label}={}){
 if(!validFields(fields)||!values||typeof values!=='object'||Array.isArray(values))return ['Custom fields'];
 const keys=new Set(fields.map(f=>f.key)),errors=Object.keys(values).filter(k=>!keys.has(k)).map(()=> 'Unknown custom field');
 for(const f of fields){
  const v=values[f.key],empty=v===undefined||v===null||v==='';
  if(empty){if(f.required&&!draft)errors.push(label(f));continue;}
  if(!(f.type==='text'?text(v,10000):f.type==='number'?validFieldNumber(f,v):f.type==='boolean'?typeof v==='boolean':f.type==='date'?date(v):f.choices.includes(v)))errors.push(label(f));
 }
 return errors;
}
