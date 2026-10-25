import {AppError} from './errors.js';
// Selections are bounded working sets; their positions always remain source ordinals.
export function datasetColumnCount(doc){
 const count=doc.content.schemaIndex?.count??doc.content.columns?.length;
 if(!Number.isSafeInteger(count)||count<1)throw new AppError('MATERIAL_MISSING');
 return count;
}
export async function selectedDatasetColumns(materials,doc,indices){
 if(!Array.isArray(indices)||!indices.length||indices.length>256||new Set(indices).size!==indices.length||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=datasetColumnCount(doc)))throw new AppError('MATERIAL_INVALID');
 const columns=[];for(const index of indices)columns.push(await materials.datasetColumn(doc,index));
 return {indices:[...indices],columns};
}
export function assertDatasetScalars(row,indices=null){
 for(const index of indices??row.cells.keys())if(typeof row.cells[index]!=='string')throw new AppError('DATASET_CELL_SCALAR_REQUIRED');
 return row;
}
