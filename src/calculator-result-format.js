import {AppError} from './errors.js';
import {catalogueFormat,catalogueRequiresCalculatorDatasetResults} from './catalogue-format.js';
export async function assertCalculatorResultFormat(workspace){if(await workspace.storageKind()!=='catalogue')throw new AppError('CATALOGUE_DAMAGED');await workspace.catalogue(async store=>{if(!catalogueRequiresCalculatorDatasetResults(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
