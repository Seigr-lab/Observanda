import {readDelimitedTable} from '../tabular-data.js';
import {decimal,compare} from './quantities.js';
import {bomImportError,bomTableDiagnostics} from './bom-import-diagnostics.js';
import labels from '../locales/en/moduleEditors.json' with {type:'json'};

export const BOM_IMPORT_BYTES=1024*1024;
export const BOM_COLUMNS=[
 ['references',labels.references,['reference','references','refs','reference(s)']],
 ['value',labels.valueDescription,['value','description']],
 ['quantity',labels.quantityPerBuild,['qty','quantity','${QUANTITY}']],
 ['footprint',labels.footprintPackage,['footprint','package']],
 ['partNumber',labels.manufacturerPart,['mpn','manufacturer part number','part number']],
 ['unit',labels.unit,['unit','units']],
 ['dnp',labels.dnp,['dnp','${DNP}','do not populate']],
 ['exclude',labels.excludeFromBom,['exclude from bom','${EXCLUDE_FROM_BOM}','exclude_from_bom']],
 ['notes',labels.notes,['notes','comment']]
];
export function readBOMTable(text,delimiter='auto',{translate}={}){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>BOM_IMPORT_BYTES)throw bomImportError('sizeLimit',{},translate);
 const diagnostics=bomTableDiagnostics(translate);let table;
 try{table=readDelimitedTable(text,{delimiter,translate:diagnostics.text});}catch(error){throw diagnostics.attach(error);}
 if(table.rows.length>200||table.columns.length>64)throw bomImportError('tableLimit',{},translate);
 return table;
}
export function suggestedBOMMapping(table){
 return Object.fromEntries(BOM_COLUMNS.map(([key,,names])=>{
  const matches=table.columns.filter(c=>names.some(n=>n.toLowerCase()===c.heading.trim().toLowerCase()));
  return [key,matches.length===1?matches[0].index:null];
 }));
}
export function validBOMMapping(mapping,width=64){
 const keys=BOM_COLUMNS.map(([key])=>key);
 return !!mapping&&typeof mapping==='object'&&Object.keys(mapping).length===keys.length&&keys.every(k=>Object.hasOwn(mapping,k)&&(mapping[k]===null||Number.isInteger(mapping[k])&&mapping[k]>=0&&mapping[k]<width))
  &&['value','quantity'].every(k=>mapping[k]!==null)&&new Set(Object.values(mapping).filter(v=>v!==null)).size===Object.values(mapping).filter(v=>v!==null).length;
}
function flag(value,label,row,translate){
 const v=value.trim().toLowerCase();
 if(['','0','false','no','n'].includes(v))return false;
 if(['1','true','yes','y','x',label==='DNP'?'dnp':'exclude'].includes(v))return true;
 throw bomImportError(label==='DNP'?'flagDnp':'flagExclude',{row,value},translate);
}
function references(value,separator,row,translate){
 const result=[];
 for(const part of value.split(separator==='space'?/\s+/:separator).map(v=>v.trim()).filter(Boolean)){
  const range=/^([a-z]+)(\d+)-([a-z]*)(\d+)$/i.exec(part);
  if(!range){result.push(part);continue;}
  const [,prefix,a,other,b]=range;
  if(a.length>12||b.length>12)throw bomImportError('referenceRange',{row},translate);
  const start=BigInt(a),end=BigInt(b);
  if(other&&other.toLowerCase()!==prefix.toLowerCase()||end<start||end-start>199n)throw bomImportError('referenceRangeValue',{row,value:part},translate);
  for(let n=start;n<=end;n++)result.push(prefix+(a.startsWith('0')?String(n).padStart(a.length,'0'):String(n)));
 }
 const joined=result.join(', ');
 if(joined.length>500)throw bomImportError('referenceLimit',{row},translate);
 return joined;
}
export function mapBOMTable(table,mapping,{referenceSeparator=',',translate}={}){
 if(!validBOMMapping(mapping,table.columns.length))throw bomImportError('mapping',{},translate);
 if(![',',';','space'].includes(referenceSeparator))throw bomImportError('separator',{},translate);
 const lines=[],excluded=[],seen=new Set();
 for(const row of table.rows){
  const cell=key=>mapping[key]===null?'':row.cells[mapping[key]];
  if(mapping.exclude!==null&&flag(cell('exclude'),'Exclude',row.line,translate)){excluded.push({row:row.line,references:cell('references'),value:cell('value')});continue;}
  const line={references:references(cell('references'),referenceSeparator,row.line,translate),value:cell('value'),quantity:cell('quantity').trim(),footprint:cell('footprint'),partNumber:cell('partNumber'),unit:mapping.unit===null?'items':cell('unit').trim(),notes:cell('notes'),dnp:mapping.dnp!==null&&flag(cell('dnp'),'DNP',row.line,translate)};
  if(!decimal(line.quantity)||compare(line.quantity,'0')<=0)throw bomImportError('quantity',{row:row.line},translate);
  for(const [key,max] of [['value',240],['footprint',240],['partNumber',240],['unit',80],['notes',2000],['references',500]]){
   const v=line[key];
   if(v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)||['value','unit'].includes(key)&&!v.trim())throw bomImportError('field',{row:row.line,field:key,max},translate);
  }
  for(const ref of line.references.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)){
   if(seen.has(ref))throw bomImportError('duplicate',{row:row.line,reference:ref},translate);seen.add(ref);
  }
  lines.push({row:row.line,...line});
 }
 if(!lines.length)throw bomImportError('empty',{},translate);
 return {lines,excluded,unmapped:table.columns.filter(c=>!Object.values(mapping).includes(c.index)).map(c=>c.label)};
}
