import {resolveMetadataValue} from './project-retired-metadata.js';
﻿// Authenticate all retained metadata independently of any optional module.
// Small payloads travel in bounded batches; larger originals travel alone.
import {ObjectIndex} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {operationAdvance,operationTotal} from './operation-progress.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function* verifiedCatalogueObjects(store){
 const index=new ObjectIndex(store,{cacheReads:true,scanAhead:true}),head=await index.head();await index.checkCounts(head);
 operationTotal(head.legacy?.length??head.root?.count??0);
 const batch=[];
 async function* values(){
  const rows=new Map((await store.db.all('SELECT id,payload FROM objects WHERE id=ANY($1::text[]) AND octet_length(payload)<=16384',batch.map(entry=>entry.id))).map(row=>[row.id,row.payload]));
  for(const entry of batch){
   let value;
   if(rows.has(entry.id)){value=await resolveMetadataValue(store,entry.id,entry.revision,store.decode('object',entry.id,rows.get(entry.id)));if(digest(serialize(value))!==entry.revision)fail();}
   else value=await store.objectValue(entry.id,entry);
   yield {id:entry.id,value};operationAdvance();
  }
  batch.length=0;
 }
 for await(const entry of index.entries(head)){batch.push(entry);if(batch.length===32)yield* values();}
 if(batch.length)yield* values();
}
