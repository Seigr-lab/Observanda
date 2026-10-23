// Replaying graph4 uses the same evaluator with encrypted scratch-only output blocks.
import {AppError} from './errors.js';
import {GraphCalculations} from './calculation-graph-evaluation.js';
import {readDatasetCell} from './dataset-cell-storage.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
export async function equalRetainedValues(actualMaterials,expectedMaterials,actual,expected,{signal}={}){let offset=0;for(;;){signal?.throwIfAborted();const a=await readDatasetCell(actualMaterials,actual,{offset,limit:4096,signal}),b=await readDatasetCell(expectedMaterials,expected,{offset,limit:4096,signal});if(a.total!==b.total||a.text!==b.text||a.next!==b.next)return false;if(a.next===null)return true;offset=a.next;}}
export async function verifyIntervalGraphValues(materials,doc,{signal}={}){
 if(doc.content.calculation?.version!==7)return;const engine=new GraphCalculations(materials),graph=await engine.graphs.read(doc.content.calculation.graph),iterator=engine.rows({calculation:doc.content.calculation},graph,{verify:true,signal})[Symbol.asyncIterator]();
 try{const header=await iterator.next();if(header.done||header.value.columnCount!==doc.content.schemaIndex.count)fail();const proof=header.value.transientMaterials;for(let page=0;page<materials.datasetPageCount(doc);page++){for(const actualRow of (await materials.retainedDatasetPage(doc,page,{metadataOnly:true})).rows){signal?.throwIfAborted();const expectedRow=await iterator.next();if(expectedRow.done)fail();const cells=expectedRow.value.cells()[Symbol.asyncIterator]();try{for await(const actual of materials.iterateDatasetCells(doc,actualRow)){const next=await cells.next();if(next.done||actual.kind!==next.value.kind||!await equalRetainedValues(materials,proof,actual.value,next.value.value,{signal}))fail();}if(!(await cells.next()).done)fail();}finally{await cells.return?.();}}}if(!(await iterator.next()).done)fail();}finally{await iterator.return?.();}
}
