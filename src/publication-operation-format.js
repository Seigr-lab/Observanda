import {AppError} from './errors.js';
import {catalogueFormat,catalogueRequiresPublicationOperations} from './catalogue-format.js';
export const publicationOperationMetadataPath=relative=>relative.startsWith('.observanda/jobs/')||/^\.observanda\/(?:websites\/[a-f0-9-]{36}\/)?publication-analysis-operations\//.test(relative);
export function publicationOperationMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return value?.type==='publication.analysis-review'||value?.type==='publication.prepare'&&value.input?.request!==undefined;
 return publicationOperationMetadataPath(relative);
}
export async function assertPublicationOperationFormat(workspace){
 await workspace.catalogue(async store=>{if(!catalogueRequiresPublicationOperations(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});
}
