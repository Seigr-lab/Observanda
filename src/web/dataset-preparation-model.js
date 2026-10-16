// Declarative JSON tree mappings. Wildcards bind array indices; user input is
// never evaluated as code. Lookup keys use exact spelling and JSON value kind.
import {packedRecords,packedField} from './dataset-packed-model.js';
export const jsonPointerParts=value=>typeof value==='string'&&value.length<=2048&&(value===''||value.startsWith('/'))&&!/~(?![01])/u.test(value)?value===''?[]:value.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~')):null;
export const jsonPointer=parts=>parts.length?'/'+parts.map(p=>String(p).replaceAll('~','~0').replaceAll('/','~1')).join('/'):'';
export function nestedMapping(input){
 const bad=()=>{throw Error('Invalid nested mapping');},path=v=>{const p=jsonPointerParts(v);if(!p)bad();return p;};
 const rows=path(input.rowsPath),joins=input.joins??[];
 if(!Array.isArray(input.fields)||!input.fields.length||input.fields.length>256||!Array.isArray(joins)||joins.length>8)bad();
 const bound=p=>p.every((v,i)=>v!=='*'||rows[i]==='*'&&p.slice(0,i).every((s,j)=>s===rows[j]));
 const names=new Set(['row','context']);
 const normalizedJoins=joins.map(j=>{
  if(j?.mode==='position'){
   const target=path(j.rowsPath);
   if(typeof j.name!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(j.name)||names.has(j.name)||!bound(target)||rows.some((value,i)=>value==='*'&&target[i]!=='*')||Object.keys(j).some(key=>!['name','mode','rowsPath','packed'].includes(key)))bad();
   names.add(j.name);return {name:j.name,mode:'position',rowsPath:j.rowsPath,...(Object.hasOwn(j,'packed')?{packed:packedRecords(j.packed)}:{})};
  }
  if(j?.mode!==undefined&&j.mode!=='key'||j&&Object.hasOwn(j,'packed'))bad();
  if(!j||typeof j.name!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(j.name)||names.has(j.name)||!bound(path(j.rowsPath))||path(j.leftPath).includes('*')||path(j.rightPath).includes('*')||!['error','keep'].includes(j.unmatched??'error'))bad();
  names.add(j.name);return {name:j.name,rowsPath:j.rowsPath,leftPath:j.leftPath,rightPath:j.rightPath,unmatched:j.unmatched??'error'};
 });
 const fields=input.fields.map(f=>{
  if(!f||typeof f.name!=='string'||!f.name.trim()||f.name.trim().length>200||!names.has(f.source??'row'))bad();
  const parts=path(f.path),source=f.source??'row';if(source==='context'?!bound(parts):parts.includes('*'))bad();
  const packing=normalizedJoins.find(j=>j.name===source)?.packed;if(packing&&!packedField(parts,packing))bad();
  return {name:f.name.trim(),path:f.path,source};
 });
 if(new Set(fields.map(f=>f.name)).size!==fields.length)bad();
 return {format:'json-nested',rowsPath:input.rowsPath,fields,joins:normalizedJoins};
}
