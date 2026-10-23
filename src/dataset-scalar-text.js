// Complete canonical scalar validation for explicitly versioned retained outputs.
// The arithmetic resource policy bounds reconstruction; storage text stays paged.
import {parseExact,ArithmeticBudget} from './tools/exact-arithmetic.js';
export async function validateScalarText(materials,value,column,{signal,budget=new ArithmeticBudget()}={}){
 if(!['integer','rational'].includes(column.representation))return false;let text='';if(typeof value==='string')text=value;else{if(!Number.isSafeInteger(value?.characters)||value.characters>budget.maxBits)throw Error('Exact retained scalar exceeds the calculation resource budget.');let offset=0;do{signal?.throwIfAborted();const page=await materials.readDatasetCell(value,{offset,limit:16384,signal});if(page.total!==value.characters||page.offset!==offset||page.next!==null&&page.next<=offset)return false;text+=page.text;offset=page.next;}while(offset!==null);if(text.length!==value.characters)return false;}if(text.length>budget.maxBits)throw Error('Exact retained scalar exceeds the calculation resource budget.');if(!(column.representation==='integer'?/^[+-]?\d+$/:/^[+-]?\d+\/[1-9]\d*$/).test(text))return false;parseExact(text,budget);return true;
}
export async function clockScalarText(materials,value,column,calculation,lineage,options){
 if(calculation?.version!==6||!lineage?.node)return false;const graph=await materials.read(calculation.graph);if(graph.content.graphVersion!==3)return false;const node=await materials.sequences.item(graph.content.graphNodesIndex,lineage.node.position);if(node.id!==lineage.node.id||node.kind!=='clock'||!['ticks','interval'].includes(node.operation))return false;return validateScalarText(materials,value,column,options);
}
