import {AppError} from './errors.js';
import {measurementRef} from './web/measurement-model.js';
import {validTableSelection,validRetainedTable} from './web/retained-table-model.js';
export async function retainedTable(materials,{ref,selection,version=2}){
 if(!measurementRef(ref)||ref.kind!=='dataset'||!validTableSelection(selection)||![1,2].includes(version))throw new AppError('DATASET_TABLE');
 const doc=await materials.read(ref),columns=await materials.datasetColumns(doc);
 if(selection.columns.some(i=>i>=columns.length))throw new AppError('DATASET_TABLE');
 const table={version,selection,headers:selection.columns.map(i=>columns[i].name+(columns[i].unit?' ['+columns[i].unit+']':'')),rows:[],...(version===2?{formats:selection.columns.map(i=>({representation:columns[i].representation,radix:columns[i].radix}))}:{})};let count=0;
 for await(const row of materials.iterateDataset(ref)){
  if(row.excluded&&!selection.includeExcluded)continue;if(count++<selection.offset)continue;
  table.rows.push({cells:selection.columns.map(i=>row.cells[i]),presence:selection.columns.map(i=>['null','absent'].includes(row.valueKinds?.[i])?row.valueKinds[i]:columns[i].missing.some(m=>m.value===row.cells[i])?'missing':'value'),exclusion:row.excluded??null});
  if(!validRetainedTable(table))throw new AppError('DATASET_TABLE');if(table.rows.length===selection.count)break;
 }
 if(!table.rows.length)throw new AppError('DATASET_TABLE');return table;
}
