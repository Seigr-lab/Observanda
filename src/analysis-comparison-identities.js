import {AppError} from './errors.js';
import {materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
// At most one authenticated dataset/run resolution per declared source. Authored
// addresses remain intact; these identities only deduplicate equivalent owners.
export function validateComparisonSourceIdentities(comparison,identities,code='CATALOGUE_DAMAGED'){
 const fail=()=>{throw new AppError(code);};
 if(!Array.isArray(identities)||identities.length!==comparison.sources.length||identities.length>32)fail();
 const datasets=new Set();
 for(const [index,value] of identities.entries()){
  if(!exact(value,['dataset','run']))fail();
  for(const key of ['dataset','run']){
   const declared=comparison.sources[index][key],resolved=value[key];
   if(declared===null){if(resolved!==null)fail();continue;}
   if(!exact(resolved,['workspaceId','kind','id','revision'])||!validMaterialReference(resolved)||!researchId(resolved.workspaceId)||['kind','id','revision'].some(name=>resolved[name]!==declared[name]))fail();
  }
  const dataset=materialReferenceKey(value.dataset);if(datasets.has(dataset))fail();datasets.add(dataset);
 }
 return identities;
}
export function comparisonSourceIdentities(comparison,resolve){
 const identities=comparison.sources.map(source=>({dataset:materialReference(resolve(source.dataset)),run:source.run?materialReference(resolve(source.run)):null}));
 return validateComparisonSourceIdentities(comparison,identities,'ANALYSIS_INVALID');
}
