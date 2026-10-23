import {AppError} from './errors.js';
import {readDatasetCell} from './dataset-cell-storage.js';
import {graphResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {exactRational} from './web/measurement-rational.js';
export async function graphScalarCell(materials,cell,policy,{signal}={}){
 if(typeof cell.value==='string')return cell;if(!policy||cell.value?.format!=='dataset-cell')throw new AppError('MATERIAL_DATASET_LIMIT');
 if(!Number.isSafeInteger(cell.value.characters)||cell.value.characters>policy.resources.maxScalarCharacters)throw new AppError('DATASET_CALCULATION_RESOURCE');
 let text='',offset=0;do{signal?.throwIfAborted();const page=await readDatasetCell(materials,cell.value,{offset,limit:4096,signal});if(page.total!==cell.value.characters||page.offset!==offset||page.next!==null&&page.next<=offset)throw new AppError('MATERIAL_MISSING');text+=page.text;if(text.length>policy.resources.maxScalarCharacters)throw new AppError('DATASET_CALCULATION_RESOURCE');offset=page.next;}while(offset!==null);
 if(text.length!==cell.value.characters)throw new AppError('MATERIAL_MISSING');return {...cell,value:text};
}
export async function policyScalarText(materials,value,column,calculation,lineage,options={}){
 if(![8,9,10,11].includes(calculation?.version)||!lineage?.node)return false;const graph=await materials.read(calculation.graph);if(graph.content.graphVersion<5)throw new AppError('MATERIAL_MISSING');const node=await materials.sequences.item(graph.content.graphNodesIndex,lineage.node.position);if(node.id!==lineage.node.id)throw new AppError('MATERIAL_MISSING');
 const cell=await graphScalarCell(materials,{value,kind:'string'},graph.content.policy,options);numericalOperation(graphResourceBudget(graph.content),budget=>exactRational(cell.value,column.representation,column.radix,budget));return true;
}
