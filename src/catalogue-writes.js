// Bounded, parameterized writes of already encrypted catalogue rows. Callers
// own the transaction; payloads and the roots that authenticate them commit
// together. Table and column identifiers are fixed here, never user supplied.
import {AppError} from './errors.js';
export async function writeCatalogueRows(db,table,rows,{create=false}={}){
 const key=table==='state'?'slot':table==='objects'?'id':null;
 if(!key)throw new TypeError('Unsupported catalogue table');
 let values=[],removed=[],bytes=0;
 const flush=async()=>{
  if(values.length){
   const tuples=Array.from({length:values.length/2},(_,i)=>'($'+(i*2+1)+',$'+(i*2+2)+')');
   try{await db.run('INSERT INTO '+table+' VALUES '+tuples.join(',')+(create?'':' ON CONFLICT('+key+') DO UPDATE SET payload=excluded.payload'),...values);}
   catch(error){if(create&&error.code==='23505')throw new AppError('CATALOGUE_DAMAGED');throw error;}values=[];
  }
  if(removed.length){await db.run('DELETE FROM '+table+' WHERE '+key+'=ANY($1::text[])',removed);removed=[];}bytes=0;
 };
 for await(const [id,payload] of rows){
  if(values.length&&bytes+(payload?.length??0)>256*1024)await flush();
  if(payload===null)removed.push(id);else{values.push(id,payload);bytes+=payload.length;}
  if(values.length/2+removed.length===32)await flush();
 }
 await flush();
}
