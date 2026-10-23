import {derivedComputation} from './web/measurement-computation.js';
import {comparisonColumns} from './analysis-scalar-policy.js';

// Read only the bounded, explicitly mapped declarations. The marker describes
// interpretation of retained finite digits; it does not change comparison keys.
export async function comparisonComputation(materials,comparison,{signal}={}){
 let result={};
 const include=async(ref,indices)=>{
  signal?.throwIfAborted();const doc=await materials.read(ref),selected=await comparisonColumns(materials,doc,[...new Set(indices.filter(index=>index!==null))],comparison,{signal});
  result=derivedComputation(result,...selected.columns);
 };
 for(const [index,source] of comparison.sources.entries())await include(source.dataset,[...Object.values(source.columns),...(comparison.expected?.source===index?[comparison.expected.actualKey]:[])]);
 if(comparison.expected)await include(comparison.expected.dataset,[comparison.expected.key,comparison.expected.value]);
 return result;
}
