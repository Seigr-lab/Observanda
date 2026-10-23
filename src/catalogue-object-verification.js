import {measurementScalarMetadata} from './measurement-scalar-format.js';
import {catalogueRequiresMeasurementScalarPolicies} from './catalogue-format.js';
import {calculatorResultMetadata} from './web/calculator-result-model.js';
import {catalogueRequiresCalculatorDatasetResults} from './catalogue-format.js';
import {catalogueFormat,catalogueRequiresCalculationPolicies} from './catalogue-format.js';
import {checkpointHasCalculationPolicy} from './web/tools/calculation-policy.js';
import {resolveMetadataValue} from './project-retired-metadata.js';
// Authenticate all retained metadata independently of any optional module.
// Small payloads travel in bounded batches; larger originals travel alone.
import {ObjectIndex} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {operationAdvance,operationTotal} from './operation-progress.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function* verifiedCatalogueObjects(store){
 const index=new ObjectIndex(store,{cacheReads:true,scanAhead:true}),head=await index.head();await index.checkCounts(head);
 operationTotal(head.legacy?.length??head.root?.count??0);
 const batch=[];let policyAdmission,resultAdmission,scalarAdmission;
 async function* values(){
  const rows=new Map((await store.db.all('SELECT id,payload FROM objects WHERE id=ANY($1::text[]) AND octet_length(payload)<=16384',batch.map(entry=>entry.id))).map(row=>[row.id,row.payload]));
  for(const entry of batch){
   let value;
   if(rows.has(entry.id)){value=await resolveMetadataValue(store,entry.id,entry.revision,store.decode('object',entry.id,rows.get(entry.id)));if(digest(serialize(value))!==entry.revision)fail();}
   else value=await store.objectValue(entry.id,entry);
   if(/^metadata:\.observanda\/module-drafts\/[a-f0-9-]{36}\.json$/.test(entry.id)){
    let checkpoint;try{checkpoint=JSON.parse(value.text);}catch{fail();}
    if(checkpointHasCalculationPolicy(checkpoint)){policyAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresCalculationPolicies);if(!await policyAdmission)fail();}
   }
   if(entry.id.startsWith('metadata:.observanda/materials/objects/')||entry.id.startsWith('metadata:.observanda/jobs/')){let metadata;try{metadata=JSON.parse(value.text);}catch{fail();}if(calculatorResultMetadata(entry.id.slice(9),metadata)){resultAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresCalculatorDatasetResults);if(!await resultAdmission)fail();}}
   if(entry.id.startsWith('metadata:.observanda/materials/')||entry.id.startsWith('metadata:.observanda/jobs/')){let metadata;try{metadata=JSON.parse(value.text);}catch{fail();}if(measurementScalarMetadata(entry.id.slice(9),metadata)){scalarAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresMeasurementScalarPolicies);if(!await scalarAdmission)fail();}}
   yield {id:entry.id,value};operationAdvance();
  }
  batch.length=0;
 }
 for await(const entry of index.entries(head)){batch.push(entry);if(batch.length===32)yield* values();}
 if(batch.length)yield* values();
}
