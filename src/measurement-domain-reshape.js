// Explicit shape and axis operations share a bounded indexed component reader.
import {AppError} from './errors.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy,defaultDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {DomainAlgebraError,domainReshapeShape,domainPermutationShape,domainPermutationIndex} from './web/measurement-domain-algebra-model.js';
import {domainUsesResourcePolicy} from './web/measurement-domain-model.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {validateDomainValue,domainValueSupported,retainDomainComponents} from './measurement-domain-storage.js';
import {resolveScalarOperand} from './measurement-scalar-storage.js';
import {datasetCellReference} from './dataset-cell-storage.js';
const fail=(code='MEASUREMENT_DOMAIN_INCOMPATIBLE')=>{throw new AppError(code);};
function handled(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;if(error instanceof DomainAlgebraError)fail(error.code);fail();}
export function domainReshapeColumn(node,column,{policy}={}){
 try{
  if(column?.representation!=='domain'||policy!==undefined&&!validDatasetResourcePolicy(policy))fail();
  const target=domainReshapeShape(column.domain,node.shape),source=column.domain,version=target.codec==='tensor'?3:source.version===1?1:2;
  const resourcePolicy=source.resourcePolicy??policy;if(version!==1&&!validDatasetResourcePolicy(resourcePolicy))fail();
  const domain={version,codec:'observanda.'+target.codec,codecVersion:1,namespace:source.namespace,shape:target.shape,component:structuredClone(source.component),...(version!==1?{resourcePolicy:structuredClone(resourcePolicy)}:{})};
  return {...structuredClone(column),domain};
 }catch(error){handled(error);}
}
export function domainPermuteColumn(node,column,{policy}={}){
 try{
  if(column?.representation!=='domain'||policy!==undefined&&!validDatasetResourcePolicy(policy))fail();
  const target=domainPermutationShape(column.domain,node.axes),output=structuredClone(column);output.domain.shape=target.shape;return output;
 }catch(error){handled(error);}
}
export async function calculateDomainReshapeNode(materials,node,cell,column,options={}){
 return calculateDomainReindex(materials,cell,column,domainReshapeColumn(node,column,options),null,options);
}
export async function calculateDomainPermuteNode(materials,node,cell,column,options={}){
 const output=domainPermuteColumn(node,column,options),axes=[...node.axes],source=structuredClone(column.domain);
 return calculateDomainReindex(materials,cell,column,output,(index,budget)=>domainPermutationIndex(source,axes,index,budget),options);
}
async function calculateDomainReindex(materials,cell,column,output,indexAt,{policy,write=fn=>fn(),signal,check=async()=>{}}={}){
 try{
  const current=async()=>{signal?.throwIfAborted();await check();signal?.throwIfAborted();};
  await current();if(!cell||cell.kind==='absent')return {kind:'absent',value:''};if(cell.kind==='null')return {kind:'null',value:''};if(typeof cell.value==='string'&&column.missing.some(item=>item.value===cell.value))return {kind:'absent',value:''};
  const value=validateDomainValue(materials,cell.value,column.domain);if(!domainValueSupported(value))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');
  const definition=value.definition,owner=domainUsesResourcePolicy(definition)?definition.resourcePolicy:defaultDatasetResourcePolicy(),operationPolicy=policy??owner;
  const scalarColumn={representation:definition.component.representation,radix:definition.component.radix,missing:[],...(domainUsesResourcePolicy(definition)?{resourcePolicy:owner}:{})};
  async function* components(){
   let page=null;
   for(let index=0;index<value.components.count;index++){
    await current();const budget=new DatasetResourceBudget(operationPolicy),sourceIndex=indexAt?numericalOperation(budget,b=>indexAt(index,b)):index,offset=Math.floor(sourceIndex/16)*16;
    if(!page||page.offset!==offset){page=await materials.sequences.page(value.components,{offset,limit:16});await current();if(page.offset!==offset||page.items.length!==Math.min(16,value.components.count-offset))fail('MATERIAL_MISSING');}
    const item=page.items[sourceIndex-offset];if(!item||Object.keys(item).length!==1||!Object.hasOwn(item,'spelling')||item.spelling!==null&&typeof item.spelling!=='string'&&(![3,4].includes(value.version)||!datasetCellReference(item.spelling)))fail('MATERIAL_MISSING');
    numericalOperation(budget,b=>b.step());if(item.spelling===null){yield {spelling:null,budget};continue;}
    const selected=await resolveScalarOperand(materials,{kind:'string',value:item.spelling},scalarColumn,{policy:operationPolicy,signal,budget});
    numericalOperation(budget,b=>validatePolicyScalar({spelling:selected.value,representation:scalarColumn.representation,radix:scalarColumn.radix},owner,{budget:b}));
    await current();yield {spelling:selected.value,budget};
   }
  }
  const result=await retainDomainComponents(materials,output.domain,components(),write,{signal});await current();return {kind:'string',value:result};
 }catch(error){handled(error);}
}
