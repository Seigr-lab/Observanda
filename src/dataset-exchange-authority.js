import {AppError} from './errors.js';
import {ResearchMaterials} from './research-materials.js';
import {workspaceReferenceNamespaceMatches} from './research-reference-namespace.js';
import {materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';

// Exact source grants belong to the initiating session. A small working
// cache avoids opening the same measurement/source for every observation.
// A native page boundary revalidates the opened grants and routing witnesses.
export async function openDatasetExchangeAuthority(materials,command,{sourceAccess,signal,check=async()=>{},retained=false}={}){
 const {workspace}=materials,namespace=(await workspace.outline()).metadata.id;
 if(command.ref?.kind!=='dataset'||command.ref.workspaceId!==namespace&&(!retained||!await workspaceReferenceNamespaceMatches(workspace,command.ref)))throw new AppError('WORKSPACE_CHANGED');
 const cache=new Map();let access,closed=false;
 const current=async()=>{
  if(closed)throw new AppError('WORKSPACE_CHANGED');
  signal?.throwIfAborted();await check();await access?.verify();
  await materials.assertOwner(command.recordId,{write:true});signal?.throwIfAborted();
 };
 const checkSource=async ref=>{
  if(closed)throw new AppError('WORKSPACE_CHANGED');
  signal?.throwIfAborted();
  if(!validMaterialReference(ref))throw new AppError('MATERIAL_INVALID');
  const scoped=materialReference({...ref,workspaceId:ref.workspaceId??namespace}),key=materialReferenceKey(scoped),cached=cache.get(key);
  if(cached)return cached;
  const external=await materials.externalReference(scoped);
  let canonical;
  if(sourceAccess){
   access??=await sourceAccess(workspace,{signal});
   canonical=await access.use(external??scoped,async(storage,address)=>{
    await new ResearchMaterials(storage).checkReference(address,{signal});
    // A completed file carries the original namespace. The owner resolver
    // authenticates each alias before the historical address can be reused.
    if(address.kind!==scoped.kind||address.id!==scoped.id||address.revision!==scoped.revision)throw new AppError('WORKSPACE_CHANGED');
    return retained?scoped:materialReference(address);
   });
  }else{
   if(external||!await workspaceReferenceNamespaceMatches(workspace,scoped))throw new AppError('ACCESS_LOCKED');
   await materials.checkReference(scoped,{signal});canonical=scoped;
  }
  if(cache.size>=256)cache.delete(cache.keys().next().value);
  cache.set(key,canonical);return canonical;
 };
 try{
  await current();
  const doc=await materials.read(command.ref);
  if(doc.recordId!==command.recordId)throw new AppError('MATERIAL_INVALID');
  return {doc,signal,check:current,checkSource,close:async()=>{closed=true;cache.clear();await access?.close();}};
 }catch(error){await access?.close();throw error;}
}

export async function withDatasetExchangeAuthority(materials,command,options,operation){
 return materials.workspace.withCatalogueConnections(async()=>{
  const grants=await openDatasetExchangeAuthority(materials,command,options);
  try{const result=await operation(grants.doc,grants);await grants.check();return result;}
  finally{await grants.close();}
 });
}
