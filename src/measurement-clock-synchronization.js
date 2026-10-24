// Exact two-point synchronization over explicitly declared, pinned clock cells.
import {AppError} from './errors.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {ExactNumber,exactOperation} from './tools/exact-arithmetic.js';
import {defaultDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {withScalarPolicy,validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {CLOCK_SYNCHRONIZATION_TOOL,validClockSynchronization,assertSynchronizationColumn,clockSynchronizationColumn} from './web/measurement-clock-synchronization-model.js';
import {derivedComputation} from './web/measurement-computation.js';
import {revisionText} from './web/revision-model.js';
import {resolveScalarDefinitions,retainScalarDefinitions,resolveScalarOperand} from './measurement-scalar-storage.js';
import {retainDomainValue} from './measurement-domain-storage.js';
export {clockSynchronizationColumn} from './web/measurement-clock-synchronization-model.js';
const fail=(code='MEASUREMENT_CLOCK_SYNCHRONIZATION')=>{throw new AppError(code);};
const absent=()=>({value:'',kind:'absent'});
const present=(cell,column)=>cell&&!['null','absent'].includes(cell.kind)&&!column.missing?.some(item=>item.value===cell.value);
const exact=(value,budget)=>new ExactNumber(value.numerator,value.denominator,budget);
const op=(name,a,b,budget)=>exactOperation(name,[a,b],budget);
const compare=(a,b,budget)=>{const difference=op('subtract',a,b,budget);return difference.n<0n?-1:difference.n>0n?1:0;};
const targetOf=column=>({unit:column.unit,...(column.quantity===undefined?{}:{quantity:structuredClone(column.quantity)}),time:structuredClone(column.time)});
const declaration=column=>Object.fromEntries(['representation','radix','unit','quantity','time','missing','resourcePolicy','computation'].filter(key=>column[key]!==undefined).map(key=>[key,column[key]]));
function handled(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;if(error.code?.startsWith('MEASUREMENT_CLOCK_SYNCHRONIZATION'))fail(error.code);fail();}
async function current({signal,check=async()=>{}}){signal?.throwIfAborted();await check();signal?.throwIfAborted();}
function scalar(cell,column,budget){
 if(!present(cell,column))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 return exact(validatePolicyScalar({spelling:cell.value,representation:column.representation,radix:column.radix},column.resourcePolicy??defaultDatasetResourcePolicy(),{budget}),budget);
}
function affine(context,budget){
 const {content,sourceColumn,referenceColumn,anchors}=context;
 const lower=exact(validatePolicyScalar(content.validity.lower,content.resourcePolicy,{budget}),budget),upper=exact(validatePolicyScalar(content.validity.upper,content.resourcePolicy,{budget}),budget);
 if(compare(lower,upper,budget)>0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');
 const x=anchors.map(pair=>scalar(pair.source,sourceColumn,budget)),y=anchors.map(pair=>scalar(pair.reference,referenceColumn,budget));
 const dx=op('subtract',x[1],x[0],budget),dy=op('subtract',y[1],y[0],budget);
 if(dx.n===0n||dy.n===0n||(dx.n<0n)!==(dy.n<0n))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 const first=dx.n>0n?x[0]:x[1],last=dx.n>0n?x[1]:x[0];
 // A narrower authored interval is permitted. Extending beyond the two
 // observations would assert extrapolation that this method does not provide.
 if(compare(lower,first,budget)<0||compare(upper,last,budget)>0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');
 return {lower,upper,x:x[0],y:y[0],slope:op('divide',dy,dx,budget)};
}
async function selectedCell(materials,locator,options){
 await current(options);const doc=await materials.read(locator.ref);await current(options);
 if(doc.kind!==undefined&&doc.kind!=='dataset')fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 const s=locator.selector,savedColumn=await materials.datasetColumn(doc,s.column),column=await resolveScalarDefinitions(materials,savedColumn,options);
 assertSynchronizationColumn(column);await current(options);
 const page=await materials.retainedDatasetPage(doc,s.page,{columns:[s.column]}),row=page.rows[s.row];await current(options);
 if(!row||row.excluded)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 const cell={value:row.cells[0],kind:row.valueKinds?.[0]??'string'};
 if(!present(cell,column))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 return {column,savedColumn,cell:await resolveScalarOperand(materials,cell,column,{...options,policy:options.policy})};
}
async function contextFor(materials,content,options){
 const anchors=[],columns=[],savedColumns=[];
 for(const pair of content.anchors){const source=await selectedCell(materials,pair.source,options),reference=await selectedCell(materials,pair.reference,options);columns.push([source.column,reference.column]);savedColumns.push([source.savedColumn,reference.savedColumn]);anchors.push({source:source.cell,reference:reference.cell});}
 const [sourceColumn,referenceColumn]=columns[0];
 if(columns[1].some((column,index)=>revisionText(column)!==revisionText(columns[0][index])))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 if(revisionText(content.target)!==revisionText(targetOf(referenceColumn)))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 return {content,sourceColumn,referenceColumn,anchors,referenceDeclaration:targetOf(savedColumns[0][1])};
}
export async function prepareClockSynchronization(materials,definition,{write=fn=>fn(),signal,check=async()=>{},base}={}){
 try{
  if(!validClockSynchronization(definition)||definition.tool!==undefined||definition.computation!==undefined||definition.inputs!==undefined)fail();
  const options={signal,check,policy:definition.resourcePolicy},resolved=await resolveScalarDefinitions(materials,{tool:CLOCK_SYNCHRONIZATION_TOOL,...definition},options),context=await contextFor(materials,resolved,options);
  const content={tool:CLOCK_SYNCHRONIZATION_TOOL,...resolved,...derivedComputation(context.sourceColumn,context.referenceColumn)};
  const budget=new DatasetResourceBudget(content.resourcePolicy);numericalOperation(budget,b=>affine({...context,content},b));await current(options);
  return await retainScalarDefinitions(materials,{...definition,tool:CLOCK_SYNCHRONIZATION_TOOL,...derivedComputation(context.sourceColumn,context.referenceColumn)},write,{signal,base:{...base,target:context.referenceDeclaration}});
 }catch(error){handled(error);}
}
export async function verifyClockSynchronization(materials,content,{policy,signal,check=async()=>{},sources=true}={}){
 try{
  if(!validClockSynchronization(content)||content.tool!==CLOCK_SYNCHRONIZATION_TOOL)fail();
  const options={signal,check,policy:policy??content.resourcePolicy},resolved=await resolveScalarDefinitions(materials,content,options);
  await current(options);if(!sources)return {content:resolved};
  const context=await contextFor(materials,resolved,options),expected=derivedComputation(context.sourceColumn,context.referenceColumn).computation;
  if(revisionText(content.computation??null)!==revisionText(expected??null))fail();
  const budget=new DatasetResourceBudget(options.policy);numericalOperation(budget,b=>withScalarPolicy(content.resourcePolicy,b,scoped=>affine(context,scoped)));await current(options);return context;
 }catch(error){handled(error);}
}
export function evaluateClockSynchronization(node,column,context,cell,{excluded=false,budget}={}){
 try{
  clockSynchronizationColumn(node,column,context.content,{policy:budget?.scalarPolicy});
  if(revisionText(declaration(column))!==revisionText(declaration(context.sourceColumn)))fail();
  const finish=(status,value)=>node.operation==='status'?{kind:'string',value:status}:status==='ready'?{kind:'string',value:value.n+'/'+value.d}:status==='outside-validity'&&node.outside==='error'?fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE'):absent();
  if(excluded)return finish('excluded-input');if(!present(cell,column))return finish('missing-input');
  budget??=new DatasetResourceBudget(context.content.resourcePolicy);
  return numericalOperation(budget,b=>withScalarPolicy(context.content.resourcePolicy,b,scoped=>{
   const model=affine(context,scoped),input=scalar(cell,column,scoped);
   if(compare(input,model.lower,scoped)<0||compare(input,model.upper,scoped)>0)return finish('outside-validity');
   const value=op('add',model.y,op('multiply',op('subtract',input,model.x,scoped),model.slope,scoped),scoped);
   const text=value.n+'/'+value.d;if(text.length>scoped.scalarPolicy.resources.maxScalarCharacters)throw Object.assign(new Error('The exact operation exceeds its saved resource policy.'),{code:'DATASET_CALCULATION_RESOURCE'});
   return finish('ready',value);
  }));
 }catch(error){handled(error);}
}
export async function calculateClockSynchronizationNode(materials,node,cell,column,{model,verified,policy,budget,signal,check=async()=>{},excluded=false,write=fn=>fn()}={}){
 try{
  const options={signal,check,policy};await current(options);
  // Cached values are immutable selected text only. Access to the pinned model
  // and its source declarations is checked again for every use.
  const doc=await materials.read(node.model);if(doc.kind!==undefined&&doc.kind!=='analysis')fail();
  let context;
  if(verified){
   context=verified;if(!validClockSynchronization(doc.content)||revisionText(await resolveScalarDefinitions(materials,doc.content,{signal}))!==revisionText(context.content)||model&&revisionText(model)!==revisionText(context.content))fail();
   for(const ref of [context.content.source.ref,context.content.anchors[0].reference.ref])await materials.read(ref);
  }else context=await verifyClockSynchronization(materials,doc.content,{policy,signal,check});
  if(model&&!verified&&revisionText(model)!==revisionText(context.content))fail();
  const resolved=excluded?cell:await resolveScalarOperand(materials,cell,column,{signal,policy:policy??context.content.resourcePolicy,budget});
  await current(options);const result=evaluateClockSynchronization(node,column,context,resolved,{excluded,budget:budget??new DatasetResourceBudget(policy??context.content.resourcePolicy)});
  if(node.operation==='status'){const output=clockSynchronizationColumn(node,column,context.content,{policy});result.value=await retainDomainValue(materials,result,output.domain,write,{signal});}
  await current(options);return result;
 }catch(error){handled(error);}
}
