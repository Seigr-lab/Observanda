import path from 'node:path';
import {readFile,unlink} from 'node:fs/promises';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {AppError} from './errors.js';
import {projectCatalogueBinding,validProjectCatalogueBinding} from './project-catalogue-owner.js';
import {labBookCatalogueBinding,validLabBookCatalogueBinding} from './lab-book-catalogue-owner.js';

export const CATALOGUE_FILE='.observanda/research.observanda';
export const CATALOGUE_ARCHIVE='.observanda/research-archive.observanda';
export const CATALOGUE_ACTIVATION='.observanda/research-activation.observanda';
const identity=(id,format)=>({format,version:1,id});

async function readIdentity(root,relative,format){
 const file=path.join(root,relative),stat=await assertRegular(file,{missing:true});
 if(!stat)return null;
 if(stat.size>1024)throw new AppError('CATALOGUE_DAMAGED');
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw new AppError('CATALOGUE_DAMAGED');}
 if(format==='observanda-postgresql'&&(validProjectCatalogueBinding(value)||validLabBookCatalogueBinding(value)))return value;
 const portable=format==='observanda-postgresql'&&value?.version===2&&value?.placement==='workspace';
 if(!value||Object.keys(value).sort().join()!==(portable?'format,id,placement,version':'format,id,version')||value.format!==format||(!portable&&value.version!==1)||
  typeof value.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id))throw new AppError('CATALOGUE_DAMAGED');
 return value;
}

export const catalogueBinding=root=>readIdentity(root,CATALOGUE_FILE,'observanda-postgresql');
export const catalogueActivation=root=>readIdentity(root,CATALOGUE_ACTIVATION,'observanda-postgresql-activation');

// The activation lock is held by the caller. Persist the intended database
// identity before its transaction commits, so a killed client can reuse it.
export async function beginCatalogueActivation(root,id){
 await atomicWrite(path.join(root,CATALOGUE_ACTIVATION),serialize(identity(id,'observanda-postgresql-activation')));
}
export async function publishCatalogueBinding(root,id,{workspace=false,projectId,labBookId}={}){
 if([workspace,projectId!==undefined,labBookId!==undefined].filter(Boolean).length>1)throw new AppError('INVALID');
 const value=labBookId!==undefined?labBookCatalogueBinding(id,labBookId):projectId!==undefined?projectCatalogueBinding(id,projectId):{...identity(id,'observanda-postgresql'),...(workspace?{version:2,placement:'workspace'}:{})};
 await atomicWrite(path.join(root,CATALOGUE_FILE),serialize(value));
}
export async function finishCatalogueActivation(root){
 // Never retire the recovery source before the verified database has a binding.
 // A lost unlink acknowledgement is safe to replay. The checkpoint stays until
 // the old archive is gone, preventing authoring against a half-finished restore.
 for(const relative of [CATALOGUE_ARCHIVE,CATALOGUE_ACTIVATION]){
  const file=path.join(root,relative);
  if(await assertRegular(file,{missing:true}))await unlink(file);
 }
}
