// Retained references already live in the authenticated metadata index. This
// small change token invalidates only the affected record's continuation; it
// stores no duplicate record bodies or growing revision list.
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {catalogueObjectPrefixCount} from './postgres-indexes.js';
import {journalRecordOwnerMutation,adoptRecordOwnerMutation,recordOwnerResourcesReclaiming} from './record-owner-resources.js';
const path=/^metadata:\.observanda\/materials\/records\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/[a-f0-9]{64}\.json$/;
const slot=id=>'retained-record-history:'+id;
export async function retainedHistoryGeneration(store,id){
 const key=slot(id),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',key);
 if(!row)return null; // Existing catalogues need no scan or rewrite on opening.
 const value=store.decode('state',key,row.payload);
 if(!value||Object.keys(value).sort().join()!=='format,generation,recordId'||value.format!==1||value.recordId!==id||!(/^[a-f0-9]{64}$/).test(value.generation))throw new AppError('CATALOGUE_DAMAGED');
 return value.generation;
}
export async function changedRetainedHistory(store,objectId,revision){
 const id=path.exec(objectId)?.[1];if(!id||recordOwnerResourcesReclaiming())return;
 const previous=await retainedHistoryGeneration(store,id),key=slot(id),before=previous===null?null:{format:1,recordId:id,generation:previous},after={format:1,recordId:id,generation:digest((previous??'')+'\0'+objectId+'\0'+(revision??''))};
 if(before)await adoptRecordOwnerMutation(store,{kind:'state',key},before);
 await journalRecordOwnerMutation(store,null,{kind:'state',key},before,after);
 await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',key,store.encode('state',key,after));
}
export async function retainedHistoryState(store,id){
 const prefix='metadata:.observanda/materials/records/'+id+'/',index=store.objectIndex({cacheReads:true}),head=await index.head();
 const count=await index.prefixCount(head,prefix),actual=await catalogueObjectPrefixCount(store.db,prefix);
 if(actual.n!==String(count))throw new AppError('CATALOGUE_DAMAGED');
 return {prefix,count,generation:await retainedHistoryGeneration(store,id)};
}
