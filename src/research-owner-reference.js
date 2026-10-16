import {selectorExists} from './web/book-selectors.js';
import {historicalRecordValue,recordRevision} from './research.js';
import {recordReferenceLocation} from './record-reference-location.js';
import {AppError} from './errors.js';

// Callers select and authenticate an owner before resolving its retained content.
export async function locateResearchReference(storage,target,{namespaceId=null}={}){
 return storage.catalogue(async store=>{
   const current=await store.snapshot();if(namespaceId!==null&&current.metadata.id!==namespaceId)throw new AppError('DATABASE_LOCATION');let exists;
   if(target.kind==='project')exists=current.metadata.projects.some(p=>p.id===target.id);
   else if(target.kind==='notebook')exists=current.metadata.notebooks.some(p=>p.id===target.id);
   else if(target.revision){const {snapshot}=await recordReferenceLocation(store,target.id,target.revision);if(snapshot.metadata.id!==current.metadata.id)throw new AppError('CATALOGUE_DAMAGED');exists=true;}
   else exists=!!await store.member(current,target.id);
   if(!exists)throw new AppError('NOT_FOUND');
   return {target:structuredClone(target),namespaceId:current.metadata.id};
 });
}
export async function resolveResearchReference(storage,target,{namespaceId=null}={}){
 return storage.catalogue(async store=>{
   const current=await store.snapshot();if(namespaceId!==null&&current.metadata.id!==namespaceId)throw new AppError('DATABASE_LOCATION');let value,revision=null;
   if(target.kind==='project')value=current.metadata.projects.find(p=>p.id===target.id);
   else if(target.kind==='notebook')value=current.metadata.notebooks.find(p=>p.id===target.id);
   else{
    let selected;
    if(target.revision){
     if(!await store.db.get('SELECT 1 FROM records WHERE id=$1 LIMIT 1',target.id))throw new AppError('NOT_FOUND');
     const index=store.historyIndex(target.id),head=await index.head(),found=await index.lookup(head,'view',target.revision,{optional:true});
     if(!found)throw new AppError('NOT_FOUND');selected=await store.historyItem(target.id,found.item);
    }else{
     const row=await store.member(current,target.id);if(!row)throw new AppError('NOT_FOUND');selected={record:await store.record(target.id,row.revision),metadata:current.metadata};
    }
    value=historicalRecordValue(selected.metadata,selected.record);revision=recordRevision(value);
    if(target.revision&&revision!==target.revision)throw new AppError('CATALOGUE_DAMAGED');
    if(!selectorExists(value,target.selector))throw new AppError('NOT_FOUND');
   }
   if(!value)throw new AppError('NOT_FOUND');return {target:structuredClone(target),revision,value};
 });
}
