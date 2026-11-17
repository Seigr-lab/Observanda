import {assertRecordOwnerRevisionVisible} from './record-owner-read-visibility.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {recordReferenceLocation} from './record-reference-location.js';
import {AppError} from './errors.js';

// Callers select and authenticate an owner before resolving its retained content.
export async function locateResearchReference(storage,target,{namespaceId=null}={}){
 return storage.catalogue(async store=>{
   const current=await store.snapshot();if(namespaceId!==null&&current.metadata.id!==namespaceId)throw new AppError('DATABASE_LOCATION');if(!await referenceNamespaceMatches(store,target))throw new AppError('NOT_FOUND');let exists;
   if(target.kind==='project')exists=current.metadata.projects.some(p=>p.id===target.id);
   else if(target.kind==='notebook')exists=current.metadata.notebooks.some(p=>p.id===target.id);
   else if(target.revision){await assertRecordOwnerRevisionVisible(store,target.id,target.revision,{code:'NOT_FOUND'});const {snapshot}=await recordReferenceLocation(store,target.id,target.revision);if(snapshot.metadata.id!==current.metadata.id)throw new AppError('CATALOGUE_DAMAGED');exists=true;}
   else exists=!!await store.member(current,target.id);
   if(!exists)throw new AppError('NOT_FOUND');
   return {target:structuredClone(target),namespaceId:current.metadata.id};
 });
}
