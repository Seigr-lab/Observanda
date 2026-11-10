// Column numbers in views always refer to the saved acquisition schema.
// Search returns a bounded result window in that same order, even for a
// table with many identically named or hidden columns.
import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {validMaterialReference} from './web/material-reference.js';

const invalid=()=>{throw new AppError('INVALID');};
const normalize=value=>value.normalize('NFKC').toLocaleLowerCase('und');

export async function searchDatasetSchema(materials,data,{check,signal}={}){
 if(!exact(data,['ref','text','offset','limit'])||!validMaterialReference(data.ref)||data.ref.kind!=='dataset'||typeof data.text!=='string'||data.text.length>300||!Number.isSafeInteger(data.offset)||data.offset<0||!Number.isSafeInteger(data.limit)||data.limit<1||data.limit>64)invalid();
 return materials.workspace.withCatalogueConnections(async()=>{
  signal?.throwIfAborted();await check?.();
  const doc=await materials.read(data.ref);
  await materials.assertOwner(doc.recordId);
  const total=doc.content.schemaIndex?.count??doc.content.columns.length;
  if(data.offset>total)invalid();
  const terms=normalize(data.text).trim().split(/\s+/u).filter(Boolean),items=[];
  let offset=data.offset;
  while(offset<total&&items.length<data.limit){
   signal?.throwIfAborted();await check?.();await materials.assertOwner(doc.recordId);
   const window=await materials.retainedSchemaPage(doc,{offset,limit:Math.min(terms.length?64:data.limit,total-offset)});
   if(!window.items.length)throw new AppError('MATERIAL_MISSING');
   for(const column of window.items){
    const position=offset++;
    const label=normalize(column.name+' '+(column.unit??''));
    if(terms.every(term=>label.includes(term)))items.push({position,name:column.name,unit:column.unit??'',representation:column.representation});
    if(items.length===data.limit)break;
   }
  }
  signal?.throwIfAborted();await check?.();await materials.assertOwner(doc.recordId);
  return {items,total,next:offset<total?offset:null};
 });
}
