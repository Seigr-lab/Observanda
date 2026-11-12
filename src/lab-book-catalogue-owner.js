import {realpath} from 'node:fs/promises';
import {AppError} from './errors.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
// Version 7 names the PostgreSQL cluster that holds the lab book's schema.
export function labBookCatalogueBinding(id,labBookId,cluster){
 if(!uuid(id)||!uuid(labBookId)||!uuid(cluster))throw new AppError('INVALID');
 return {format:'observanda-postgresql',version:7,id,placement:'lab-book',labBookId,cluster};
}
export function validLabBookCatalogueBinding(value){
 return Boolean(value&&value.format==='observanda-postgresql'&&value.version===7&&value.placement==='lab-book'&&uuid(value.id)&&uuid(value.labBookId)&&uuid(value.cluster)&&Object.keys(value).sort().join()==='cluster,format,id,labBookId,placement,version');
}
export function assertLabBookCatalogueOwner(binding,labBookId){
 if(!uuid(labBookId))throw new AppError('INVALID');
 if(binding&&(!validLabBookCatalogueBinding(binding)||binding.labBookId!==labBookId))throw new AppError('DATABASE_LOCATION');
}
export async function assertLabBookCatalogueEnvironment(root,labBookId,env){
 if(!uuid(labBookId))throw new AppError('INVALID');
 if(env.OBSERVANDA_LAB_BOOK_ID!==labBookId||env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT!==await realpath(root)||env.OBSERVANDA_WORKSPACE_DATABASE_ROOT||env.OBSERVANDA_PROJECT_DATABASE_ROOT||env.OBSERVANDA_PROJECT_ID)throw new AppError('DATABASE_LOCATION');
}
