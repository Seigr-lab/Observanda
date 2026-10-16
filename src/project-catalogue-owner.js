import {realpath} from 'node:fs/promises';
import {AppError} from './errors.js';
import {assertLabBookCatalogueOwner,assertLabBookCatalogueEnvironment} from './lab-book-catalogue-owner.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function projectCatalogueBinding(id,projectId){
 if(!uuid(id)||!uuid(projectId))throw new AppError('INVALID');
 return {format:'observanda-postgresql',version:3,id,placement:'project',projectId};
}
export function validProjectCatalogueBinding(value){
 return value&&value.format==='observanda-postgresql'&&value.version===3&&value.placement==='project'&&uuid(value.id)&&uuid(value.projectId)&&Object.keys(value).sort().join()==='format,id,placement,projectId,version';
}
export function assertCatalogueOwner(binding,projectId,labBookId){
 if(labBookId!==undefined){if(projectId!==undefined)throw new AppError('INVALID');return assertLabBookCatalogueOwner(binding,labBookId);}
 if(binding?.placement==='lab-book')throw new AppError('DATABASE_LOCATION');
 if(projectId!==undefined&&!uuid(projectId))throw new AppError('INVALID');
 if(binding?.placement==='project'){
  if(!validProjectCatalogueBinding(binding)||projectId!==binding.projectId)throw new AppError('DATABASE_LOCATION');
 }else if(binding&&projectId!==undefined)throw new AppError('DATABASE_LOCATION');
}
export async function assertCatalogueEnvironment(root,projectId,env,labBookId){
 if(labBookId!==undefined){if(projectId!==undefined)throw new AppError('INVALID');return assertLabBookCatalogueEnvironment(root,labBookId,env);}
 if(env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT||env.OBSERVANDA_LAB_BOOK_ID)throw new AppError('DATABASE_LOCATION');
 if(projectId!==undefined){
  if(env.OBSERVANDA_PROJECT_ID!==projectId||env.OBSERVANDA_PROJECT_DATABASE_ROOT!==await realpath(root)||env.OBSERVANDA_WORKSPACE_DATABASE_ROOT)throw new AppError('DATABASE_LOCATION');
 }else if(env.OBSERVANDA_PROJECT_DATABASE_ROOT||env.OBSERVANDA_PROJECT_ID)throw new AppError('DATABASE_LOCATION');
}
