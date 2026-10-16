import {readDelimitedTable} from '../tabular-data.js';
import {decimal,compare} from './quantities.js';

export const BOM_IMPORT_BYTES=1024*1024;
export const BOM_COLUMNS=[
 ['references','References',['reference','references','refs','reference(s)']],
 ['value','Value / description',['value','description']],
 ['quantity','Quantity per build',['qty','quantity','${QUANTITY}']],
 ['footprint','Footprint / package',['footprint','package']],
 ['partNumber','Manufacturer part number',['mpn','manufacturer part number','part number']],
 ['unit','Unit',['unit','units']],
 ['dnp','Do not populate (DNP)',['dnp','${DNP}','do not populate']],
 ['exclude','Exclude from BOM',['exclude from bom','${EXCLUDE_FROM_BOM}','exclude_from_bom']],
 ['notes','Notes',['notes','comment']]
];
export function readBOMTable(text,delimiter='auto'){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>BOM_IMPORT_BYTES)throw Error('Import a BOM table up to 1 MiB.');
 const table=readDelimitedTable(text,{delimiter});
 if(table.rows.length>200||table.columns.length>64)throw Error('Import up to 200 rows and 64 columns per BOM.');
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
function flag(value,label,row){
 const v=value.trim().toLowerCase();
 if(['','0','false','no','n'].includes(v))return false;
 if(['1','true','yes','y','x',label==='DNP'?'dnp':'exclude'].includes(v))return true;
 throw Error('Line '+row+': '+label+' value "'+value+'" is ambiguous. Use blank/no/false/0 or yes/true/1.');
}
function references(value,separator,row){
 const result=[];
 for(const part of value.split(separator==='space'?/\s+/:separator).map(v=>v.trim()).filter(Boolean)){
  const range=/^([a-z]+)(\d+)-([a-z]*)(\d+)$/i.exec(part);
  if(!range){result.push(part);continue;}
  const [,prefix,a,other,b]=range;
  if(a.length>12||b.length>12)throw Error('Line '+row+': unsupported reference range. Use explicit references.');
  const start=BigInt(a),end=BigInt(b);
  if(other&&other.toLowerCase()!==prefix.toLowerCase()||end<start||end-start>199n)throw Error('Line '+row+': unsupported reference range '+part+'. Use explicit references.');
  for(let n=start;n<=end;n++)result.push(prefix+(a.startsWith('0')?String(n).padStart(a.length,'0'):String(n)));
 }
 const joined=result.join(', ');
 if(joined.length>500)throw Error('Line '+row+': too many references. Split the group into smaller BOM rows.');
 return joined;
}
export function mapBOMTable(table,mapping,{referenceSeparator=','}={}){
 if(!validBOMMapping(mapping,table.columns.length))throw Error('Map value and quantity to separate columns. Each column can be used once.');
 if(![',',';','space'].includes(referenceSeparator))throw Error('Choose a supported reference separator.');
 const lines=[],excluded=[],seen=new Set();
 for(const row of table.rows){
  const cell=key=>mapping[key]===null?'':row.cells[mapping[key]];
  if(mapping.exclude!==null&&flag(cell('exclude'),'Exclude',row.line)){excluded.push({row:row.line,references:cell('references'),value:cell('value')});continue;}
  const line={references:references(cell('references'),referenceSeparator,row.line),value:cell('value'),quantity:cell('quantity').trim(),footprint:cell('footprint'),partNumber:cell('partNumber'),unit:mapping.unit===null?'items':cell('unit').trim(),notes:cell('notes'),dnp:mapping.dnp!==null&&flag(cell('dnp'),'DNP',row.line)};
  if(!decimal(line.quantity)||compare(line.quantity,'0')<=0)throw Error('Line '+row.line+': quantity must be a positive decimal, without formulas, grouping or unit suffixes.');
  for(const [key,max] of [['value',240],['footprint',240],['partNumber',240],['unit',80],['notes',2000],['references',500]]){
   const v=line[key];
   if(v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)||['value','unit'].includes(key)&&!v.trim())throw Error('Line '+row.line+': check '+key+' (up to '+max+' characters).');
  }
  for(const ref of line.references.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)){
   if(seen.has(ref))throw Error('Line '+row.line+': reference '+ref+' appears more than once.');seen.add(ref);
  }
  lines.push({row:row.line,...line});
 }
 if(!lines.length)throw Error('No component rows remain after exclusions.');
 return {lines,excluded,unmapped:table.columns.filter(c=>!Object.values(mapping).includes(c.index)).map(c=>c.label)};
}
