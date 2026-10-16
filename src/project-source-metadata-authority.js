// Validate changed metadata against the source owners that were already
// retired when this write began. The paired read sees deleted/overwritten
// headers; the current transaction sees new ones, including buffered writes.
import {ProjectSourceAuthority} from './project-source-authority.js';
import {projectSourceMetadataOwner} from './project-source-metadata-owner.js';
import {projectMetadataChanges} from './project-source-changes.js';
import {projectSourceIndexChanges} from './project-source-index-changes.js';
import {withCatalogueInspection} from './catalogue-inspection.js';
import {withFlushedMetadataBatch} from './metadata-batch.js';
async function scopes(store){
 const authority=new ProjectSourceAuthority(store),snapshot=await store.snapshot(),metadata=snapshot.metadata;
 return {namespaceId:metadata.id,projectId:null,head:await store.head(),current:metadata,
  notebook:id=>authority.scope('notebook',id,metadata),website:id=>authority.scope('website',id,metadata),record:async()=>null};
}
export async function withProjectSourceMetadataAuthority(workspace,db,operation){
 const after=workspace.catalogueStore(db);if(workspace.projectId||workspace.labBookId||!await new ProjectSourceAuthority(after).active())return operation();
 const reader=await workspace.openCatalogue();
 try{
  await reader.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const before=workspace.catalogueStore(reader),authority=new ProjectSourceAuthority(before);await before.head();
  const result=await operation();
  await withFlushedMetadataBatch(after,()=>withCatalogueInspection(before,after,async()=>{
   const oldScopes=await scopes(before),newScopes=await scopes(after),oldOwner=projectSourceMetadataOwner(before,oldScopes),newOwner=projectSourceMetadataOwner(after,newScopes);
   const writable=async owner=>{
    if(owner?.kind==='project')await authority.writable(owner.projectId);
    else if(owner?.kind==='projects')for(const id of owner.projectIds)await authority.writable(id);
   };
   for await(const change of projectMetadataChanges(before,after)){
    const index=projectSourceIndexChanges(before,after,newScopes,change.id);
    if(index){for await(const owner of index)await writable(owner);continue;}
    if(change.before)await writable(await oldOwner(change.id));
    if(change.after)await writable(await newOwner(change.id,{added:!change.before}));
   }
  }));return result;
 }finally{await reader.close();}
}
