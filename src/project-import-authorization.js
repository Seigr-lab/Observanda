import {validPortabilityCollection,releasePortabilityCollection} from './portability-collection.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';

// Receipt validation and namespace cleanup do not load the interactive import
// controller. Lifecycle admission must be usable before owner classes load.
export function validImportAuthorization(value){
 const access=value?.access;
 return !!access&&access.version===1&&['import','cancel'].includes(access.intent)&&researchId(access.session)&&researchId(access.revision)&&Number.isSafeInteger(access.cursor)&&access.cursor>=0&&validPortabilityCollection(access.candidates)&&validPortabilityCollection(access.grants)&&access.candidates.id!==access.grants.id&&access.cursor<=access.candidates.count&&(access.initializing===undefined||access.initializing===true);
}
export async function eraseImportAuthorization(registry,value){
 if(!value.access)return;if(!validImportAuthorization(value))throw new AppError('STORAGE_COPY');
 // The receipt remains the cleanup authority until both namespaces, including
 // superseded roots, have been erased. Retrying either erase is harmless.
 await releasePortabilityCollection(registry.workspace,value.access.grants);
 await releasePortabilityCollection(registry.workspace,value.access.candidates);delete value.access;
}
