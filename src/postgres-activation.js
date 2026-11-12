import path from 'node:path';
import {unlink} from 'node:fs/promises';
import {assertRegular,atomicWrite,serialize,readStorageFile} from './storage.js';
import {AppError} from './errors.js';
import {projectCatalogueBinding,validProjectCatalogueBinding} from './project-catalogue-owner.js';
import {labBookCatalogueBinding,validLabBookCatalogueBinding} from './lab-book-catalogue-owner.js';
import {nativeDestination} from './native-destination.js';

export const CATALOGUE_FILE='.observanda/research.observanda';
export const CATALOGUE_ARCHIVE='.observanda/research-archive.observanda';
export const CATALOGUE_ACTIVATION='.observanda/research-activation.observanda';
const identity=(id,format)=>({format,version:1,id});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
// Catalogue bindings name the PostgreSQL cluster that holds their schema:
// version 5 for a workspace root, 6 for a project (project-catalogue-owner.js)
// and 7 for a lab book (lab-book-catalogue-owner.js). A root catalogue's
// cluster is either the workspace's own ('workspace') or an organization's
// configured PostgreSQL server ('installation').
export function workspaceCatalogueBinding(id,cluster,placement='workspace'){
 if(!uuid(id)||!uuid(cluster)||!['workspace','installation'].includes(placement))throw new AppError('INVALID');
 return {format:'observanda-postgresql',version:5,id,placement,cluster};
}
export function validWorkspaceCatalogueBinding(value){
 return Boolean(value&&value.format==='observanda-postgresql'&&value.version===5&&['workspace','installation'].includes(value.placement)&&uuid(value.id)&&uuid(value.cluster)&&Object.keys(value).sort().join()==='cluster,format,id,placement,version');
}
// Bindings from versions 1-4 carry no cluster identity. They are converted
// outside the product and refused here, never upgraded in place.
function catalogueBindingValue(value){
 if(validWorkspaceCatalogueBinding(value)||validProjectCatalogueBinding(value)||validLabBookCatalogueBinding(value))return value;
 if(value?.format==='observanda-postgresql'&&[1,2,3,4].includes(value.version))throw new AppError('CATALOGUE_BINDING_RETIRED');
 if(value?.format==='observanda-postgresql'&&Number.isSafeInteger(value.version)&&value.version>7)throw new AppError('CATALOGUE_NEWER');
 throw new AppError('CATALOGUE_DAMAGED');
}

async function readIdentity(root,relative,format){
 const file=path.join(root,relative),stat=await assertRegular(file,{missing:true});
 if(!stat)return null;
 if(stat.size>1024)throw new AppError('CATALOGUE_DAMAGED');
 let value;try{value=JSON.parse(await readStorageFile(file,'utf8',1024));}catch(error){if(error.code==='ENOENT')return null;throw new AppError('CATALOGUE_DAMAGED');}
 if(format==='observanda-postgresql')return catalogueBindingValue(value);
 if(!value||Object.keys(value).sort().join()!=='format,id,version'||value.format!==format||value.version!==1||!uuid(value.id))throw new AppError('CATALOGUE_DAMAGED');
 return value;
}

export const catalogueBinding=root=>readIdentity(root,CATALOGUE_FILE,'observanda-postgresql');
export const catalogueActivation=root=>readIdentity(root,CATALOGUE_ACTIVATION,'observanda-postgresql-activation');

// The activation lock is held by the caller. Persist the intended database
// identity before its transaction commits, so a killed client can reuse it.
export async function beginCatalogueActivation(root,id){
 await atomicWrite(path.join(root,CATALOGUE_ACTIVATION),serialize(identity(id,'observanda-postgresql-activation')));
}
export async function publishCatalogueBinding(root,id,{cluster,installation=false,projectId,labBookId}={}){
 if([installation,projectId!==undefined,labBookId!==undefined].filter(Boolean).length>1)throw new AppError('INVALID');
 const value=labBookId!==undefined?labBookCatalogueBinding(id,labBookId,cluster):projectId!==undefined?projectCatalogueBinding(id,projectId,cluster):workspaceCatalogueBinding(id,cluster,installation?'installation':'workspace');
 await atomicWrite(path.join(root,CATALOGUE_FILE),serialize(value));
}
export async function finishCatalogueActivation(root){
 // Never retire the recovery source before the verified database has a binding.
 // A lost unlink acknowledgement is safe to replay. The checkpoint stays until
 // the old archive is gone, preventing authoring against a half-finished restore.
 for(const relative of [CATALOGUE_ARCHIVE,CATALOGUE_ACTIVATION]){
  const file=path.join(root,relative);
  const admitted=nativeDestination(file);if(admitted)await admitted.remove(file,{missing:true});else if(await assertRegular(file,{missing:true}))await unlink(file);
 }
}
