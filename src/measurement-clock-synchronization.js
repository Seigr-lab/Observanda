import {projectDatasetRows} from './dataset-storage.js';
// Exact two-point synchronization over explicitly declared, pinned clock cells.
import {AppError} from './errors.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {ExactNumber,exactOperation} from './tools/exact-arithmetic.js';
import {defaultDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {withScalarPolicy,validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {CLOCK_SYNCHRONIZATION_TOOL,validClockSynchronization,validClockSynchronizationSegment,validClockSynchronizationAnchor,compareSynchronizationRows,validSynchronizationRow,assertSynchronizationColumn,clockSynchronizationColumn} from './web/measurement-clock-synchronization-model.js';
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
 if(content.version!==2&&(compare(lower,first,budget)<0||compare(upper,last,budget)>0))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');
 return {lower,upper,x:x[0],y:y[0],slope:op('divide',dy,dx,budget)};
}
async function selectedCell(materials,locator,options){
 await current(options);const doc=await materials.read(locator.ref);await current(options);
 if(doc.kind!==undefined&&doc.kind!=='dataset')fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 const s=locator.selector,savedColumn=await materials.datasetColumn(doc,s.column),column=await resolveScalarDefinitions(materials,savedColumn,options);
 assertSynchronizationColumn(column,{segmented:options.segmented===true});await current(options);
 const indexed=doc.content?.datasetFormat===3,page=await materials.retainedDatasetPage(doc,s.page,indexed?{metadataOnly:true}:{columns:[s.column]});let row=page.rows[s.row];await current(options);
 if(!row||row.excluded)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 if(indexed)row=(await projectDatasetRows(materials,doc,[row],[s.column])).rows[0];await current(options);
 const cell={value:row.cells[0],kind:row.valueKinds?.[0]??'string'};
 if(!present(cell,column))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 return {column,savedColumn,cell:await resolveScalarOperand(materials,cell,column,{...options,policy:options.policy})};
}
async function contextFor(materials,content,options){
 if(content.version===2)return segmentedContext(materials,content,options);
 const anchors=[],columns=[],savedColumns=[];
 for(const pair of content.anchors){const source=await selectedCell(materials,pair.source,options),reference=await selectedCell(materials,pair.reference,options);columns.push([source.column,reference.column]);savedColumns.push([source.savedColumn,reference.savedColumn]);anchors.push({source:source.cell,reference:reference.cell});}
 const [sourceColumn,referenceColumn]=columns[0];
 if(columns[1].some((column,index)=>revisionText(column)!==revisionText(columns[0][index])))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 if(revisionText(content.target)!==revisionText(targetOf(referenceColumn)))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 return {content,sourceColumn,referenceColumn,anchors,referenceDeclaration:targetOf(savedColumns[0][1])};
}
export async function prepareClockSynchronization(materials,definition,{write=fn=>fn(),signal,check=async()=>{},base,complete=true,headerOnly=false}={}){
 try{
  if(!validClockSynchronization(definition)||definition.tool!==undefined||definition.computation!==undefined||definition.inputs!==undefined||definition.inputsIndex!==undefined||headerOnly&&(definition.version!==2||complete!==false))fail();
  const options={signal,check,policy:definition.resourcePolicy,complete,headerOnly,...(definition.version===2?{budget:segmentedBudget(definition)}:{})},resolved=await resolveScalarDefinitions(materials,{tool:CLOCK_SYNCHRONIZATION_TOOL,...definition},options),context=await contextFor(materials,resolved,options);
  const content={tool:CLOCK_SYNCHRONIZATION_TOOL,...resolved,...derivedComputation(context.sourceColumn,context.referenceColumn)};
  if(content.version===1){const budget=new DatasetResourceBudget(content.resourcePolicy);numericalOperation(budget,b=>affine({...context,content},b));}await current(options);
  return await retainScalarDefinitions(materials,{...definition,tool:CLOCK_SYNCHRONIZATION_TOOL,...derivedComputation(context.sourceColumn,context.referenceColumn)},write,{signal,base:{...base,target:context.referenceDeclaration}});
 }catch(error){handled(error);}
}
export async function verifyClockSynchronization(materials,content,{policy,signal,check=async()=>{},sources=true,complete=true,budget}={}){
 try{
  if(!validClockSynchronization(content)||content.tool!==CLOCK_SYNCHRONIZATION_TOOL)fail();
  const options={signal,check,policy:policy??content.resourcePolicy,complete,...(content.version===2?{budget:segmentedBudget(content,policy,budget)}:{})},resolved=await resolveScalarDefinitions(materials,content,options);
  await current(options);if(!sources)return {content:resolved};
  const context=await contextFor(materials,resolved,options),expected=derivedComputation(context.sourceColumn,context.referenceColumn).computation;
  if(revisionText(content.computation??null)!==revisionText(expected??null))fail();
  if(content.version===1){const owned=new DatasetResourceBudget(options.policy);numericalOperation(owned,b=>withScalarPolicy(content.resourcePolicy,b,scoped=>affine(context,scoped)));}await current(options);return context;
 }catch(error){handled(error);}
}
export function evaluateClockSynchronization(node,column,context,cell,{excluded=false,budget}={}){
 try{
  clockSynchronizationColumn(node,column,context.content,{policy:budget?.scalarPolicy});
  if(revisionText(declaration(column))!==revisionText(declaration(context.sourceColumn)))fail();
  const finish=(status,value)=>node.operation==='status'?{kind:'string',value:status}:status==='ready'?{kind:'string',value:value.n+'/'+value.d}:status==='outside-validity'&&node.outside==='error'?fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE'):absent();
  if(excluded)return finish('excluded-input');if(!present(cell,column))return finish('missing-input');
  if(context.content.version===2&&context.selection?.status!=='ready')return finish(context.selection?.status??'outside-validity');
  budget??=new DatasetResourceBudget(context.content.resourcePolicy);
  return numericalOperation(budget,b=>withScalarPolicy(context.content.resourcePolicy,b,scoped=>{
   const selected=context.content.version===2?{...context,content:{...context.content,validity:context.segment.validity,resourcePolicy:context.segment.resourcePolicy}}:context;
   const model=affine(selected,scoped),input=scalar(cell,column,scoped);
   if(compare(input,model.lower,scoped)<0||compare(input,model.upper,scoped)>0)return finish('outside-validity');
   const value=op('add',model.y,op('multiply',op('subtract',input,model.x,scoped),model.slope,scoped),scoped);
   const text=value.n+'/'+value.d;if(text.length>scoped.scalarPolicy.resources.maxScalarCharacters)throw Object.assign(new Error('The exact operation exceeds its saved resource policy.'),{code:'DATASET_CALCULATION_RESOURCE'});
   return finish('ready',value);
  }));
 }catch(error){handled(error);}
}
export async function calculateClockSynchronizationNode(materials,node,cell,column,{model,verified,policy,budget,signal,check=async()=>{},excluded=false,write=fn=>fn(),location}={}){
 try{
  const options={signal,check,policy};await current(options);
  // Cached values are immutable selected text only. Access to the pinned model
  // and its source declarations is checked again for every use.
  const doc=await materials.read(node.model);if(doc.kind!==undefined&&doc.kind!=='analysis'||!validClockSynchronization(doc.content))fail();
  const operationBudget=doc.content.version===2?segmentedBudget(doc.content,policy,budget):budget??new DatasetResourceBudget(policy??doc.content.resourcePolicy);
  let context;
  if(verified){
   context=verified;if(!validClockSynchronization(doc.content)||revisionText(await resolveScalarDefinitions(materials,doc.content,{signal,...(doc.content.version===2?{budget:operationBudget}:{})}))!==revisionText(context.content)||model&&revisionText(model)!==revisionText(context.content))fail();
   for(const ref of [context.content.source.ref,context.content.version===2?context.content.reference.ref:context.content.anchors[0].reference.ref])await materials.read(ref);
  }else context=await verifyClockSynchronization(materials,doc.content,{policy,signal,check,...(doc.content.version===2?{budget:operationBudget}:{})});
  if(model&&!verified&&revisionText(model)!==revisionText(context.content))fail();
  const resolved=excluded?cell:await resolveScalarOperand(materials,cell,column,{signal,policy:policy??context.content.resourcePolicy,budget:operationBudget});
  if(context.content.version===2){const selected=await selectedSegmentAnchors(materials,context,resolved,column,{...options,location,excluded,budget:operationBudget});context={...context,...selected};}
  await current(options);const result=evaluateClockSynchronization(node,column,context,resolved,{excluded,budget:operationBudget});
  if(node.operation==='status'){const output=clockSynchronizationColumn(node,column,context.content,{policy});result.value=await retainDomainValue(materials,result,output.domain,write,{signal});}
  await current(options);return result;
 }catch(error){handled(error);}
}

// Version 2 stores only immutable sequence descriptors in compiled graph state.
// All scans and binary searches retain one segment and at most two paired cells.
function segmentedBudget(content,policy,caller){
 const owned=structuredClone(content.resourcePolicy);for(const declared of [policy,caller?.scalarPolicy].filter(Boolean))for(const key of Object.keys(owned.resources))owned.resources[key]=Math.min(owned.resources[key],declared.resources[key]);
 const budget=new DatasetResourceBudget(owned);if(!caller)return budget;
 return {scalarPolicy:owned,maxBits:Math.min(budget.maxBits,caller.maxBits),run:operation=>budget.run(()=>caller.run(operation)),step(){budget.step();caller.step();},size(...values){budget.size(...values);caller.size(...values);},product(a,b){const value=budget.product(a,b);caller.step();caller.size(value);return value;},power(a,n){const value=budget.power(a,n);caller.step();caller.size(value);return value;}};
}
const v2run=(options,operation)=>numericalOperation(options.budget,operation);
async function segmentAt(materials,content,position,options){
 await current(options);materials.sequences.validate(content.segmentsIndex);const saved=await materials.sequences.item(content.segmentsIndex,position);await current(options);
 if(!validClockSynchronizationSegment(saved,{complete:options.complete??true}))fail();materials.sequences.validate(saved.anchorsIndex);
 return resolveScalarDefinitions(materials,saved,options);
}
async function anchorAt(materials,context,segment,position,options){
 await current(options);const pair=await materials.sequences.item(segment.anchorsIndex,position);await current(options);
 if(!validClockSynchronizationAnchor(pair,context.content)||compareSynchronizationRows(pair.source.selector,segment.range.first)<0||compareSynchronizationRows(pair.source.selector,segment.range.last)>0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 const source=await selectedCell(materials,pair.source,{...options,segmented:true}),reference=await selectedCell(materials,pair.reference,options);
 if(revisionText(source.column)!==revisionText(context.sourceColumn)||revisionText(reference.column)!==revisionText(context.referenceColumn))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 return {position,pair,values:{source:source.cell,reference:reference.cell}};
}
function segmentBounds(segment,options){return v2run(options,b=>{const lower=exact(validatePolicyScalar(segment.validity.lower,segment.resourcePolicy,{budget:b}),b),upper=exact(validatePolicyScalar(segment.validity.upper,segment.resourcePolicy,{budget:b}),b);if(compare(lower,upper,b)>0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');return {lower,upper};});}
async function segmentedContext(materials,content,options){
 const columns=[],saved=[];
 for(const [index,binding] of [content.source,content.reference].entries()){
  await current(options);const doc=await materials.read(binding.ref);await current(options);if(doc.kind!==undefined&&doc.kind!=='dataset')fail();
  const original=await materials.datasetColumn(doc,binding.column),column=await resolveScalarDefinitions(materials,original,options);assertSynchronizationColumn(column,{segmented:index===0});saved.push(original);columns.push(column);
 }
 const context={content,sourceColumn:columns[0],referenceColumn:columns[1],referenceDeclaration:targetOf(saved[1])};if(revisionText(content.target)!==revisionText(targetOf(columns[1])))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 if(options.headerOnly)return context;
 materials.sequences.validate(content.segmentsIndex);if(options.complete!==false&&content.segmentsIndex.count===0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
 let previousSegment;
 for(let position=0;position<content.segmentsIndex.count;position++){
  const segment=await segmentAt(materials,content,position,options),bounds=segmentBounds(segment,options);
  if(options.complete!==false&&previousSegment&&compareSynchronizationRows(previousSegment.range.last,segment.range.first)>=0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');
  // The row range names retained source observations, including excluded rows.
  const doc=await materials.read(content.source.ref);for(const endpoint of [segment.range.first,segment.range.last]){await current(options);const page=await materials.retainedDatasetPage(doc,endpoint.page,{metadataOnly:true});await current(options);if(!page.rows[endpoint.row])fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');}
  let prior,first,last;
  for(let at=0;at<segment.anchorsIndex.count;at++){
   const selected=await anchorAt(materials,context,segment,at,options);
   const numbers=v2run(options,b=>({x:scalar(selected.values.source,context.sourceColumn,b),y:scalar(selected.values.reference,context.referenceColumn,b)}));
   if(options.complete!==false&&prior&&(compareSynchronizationRows(prior.pair.source.selector,selected.pair.source.selector)>=0||v2run(options,b=>compare(prior.x,numbers.x,b)>=0||compare(prior.y,numbers.y,b)>=0)))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
   first??=numbers.x;last=numbers.x;prior={pair:selected.pair,...numbers};
  }
  if(options.complete!==false&&v2run(options,b=>compare(bounds.lower,first,b)<0||compare(bounds.upper,last,b)>0))fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');
  previousSegment=segment;
 }
 await current(options);return context;
}
async function selectedSegmentAnchors(materials,context,cell,column,options){
 const empty=status=>({selection:{segment:null,bracket:[],status}});
 if(revisionText(declaration(column))!==revisionText(declaration(context.sourceColumn)))fail();
 await current(options);if(options.excluded||options.location?.excluded)return empty('excluded-input');if(!present(cell,column)||options.location===null||options.location===undefined)return empty('missing-input');
 const {page,row}=options.location;if(!validSynchronizationRow({page,row})||options.location.kind!==undefined&&options.location.kind!=='dataset')fail();
 const content=context.content;let lower=0,upper=content.segmentsIndex.count;
 while(lower<upper){const at=lower+Math.floor((upper-lower)/2),segment=await segmentAt(materials,content,at,options);if(compareSynchronizationRows(segment.range.last,{page,row})<0)lower=at+1;else upper=at;}
 if(lower===content.segmentsIndex.count)return empty('outside-validity');
 const position=lower,segment=await segmentAt(materials,content,position,options);if(compareSynchronizationRows(segment.range.first,{page,row})>0)return empty('outside-validity');
 const bounds=segmentBounds(segment,options),input=v2run(options,b=>scalar(cell,column,b));
 if(v2run(options,b=>compare(input,bounds.lower,b)<0||compare(input,bounds.upper,b)>0))return {segment,selection:{segment:{id:segment.id,position},bracket:[],status:'outside-validity'}};
 lower=0;upper=segment.anchorsIndex.count;
 while(lower<upper){const at=lower+Math.floor((upper-lower)/2),selected=await anchorAt(materials,context,segment,at,options);if(v2run(options,b=>compare(scalar(selected.values.source,context.sourceColumn,b),input,b)<=0))lower=at+1;else upper=at;}
 const first=Math.max(0,Math.min(lower-1,segment.anchorsIndex.count-2)),left=await anchorAt(materials,context,segment,first,options),right=await anchorAt(materials,context,segment,first+1,options);
 v2run(options,b=>{const x0=scalar(left.values.source,column,b),x1=scalar(right.values.source,column,b),y0=scalar(left.values.reference,context.referenceColumn,b),y1=scalar(right.values.reference,context.referenceColumn,b);if(compare(x0,x1,b)>=0||compare(y0,y1,b)>=0||compare(input,x0,b)<0||compare(input,x1,b)>0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');});
 return {segment,anchors:[left.values,right.values],selection:{segment:{id:segment.id,position},bracket:[left,right].map(({position,pair})=>({position,pair})),status:'ready'}};
}
export async function selectClockSynchronizationAnchors(materials,context,cell,column,{location,policy,signal,check=async()=>{},excluded=false,budget}={}){
 try{if(context.content.version!==2||!validClockSynchronization(context.content))fail();const options={location,policy:policy??context.content.resourcePolicy,signal,check,excluded,budget:segmentedBudget(context.content,policy,budget)},content=await resolveScalarDefinitions(materials,context.content,options),fresh=await segmentedContext(materials,content,{...options,headerOnly:true});if(revisionText(content.computation??null)!==revisionText(derivedComputation(fresh.sourceColumn,fresh.referenceColumn).computation??null))fail();const resolved=excluded?cell:await resolveScalarOperand(materials,cell,column,options);return (await selectedSegmentAnchors(materials,fresh,resolved,column,options)).selection;}catch(error){handled(error);}
}

// Draft edits validate one authored entry. Full scientific invariants are
// checked when a complete pinned revision is compiled or verified for execution.
export async function validateClockSynchronizationEdit(materials,content,{segment,anchor,policy,signal,check=async()=>{},budget}={}){
 try{
  if(content?.version!==2||!validClockSynchronization(content)||anchor&&!segment)fail();
  const options={policy:policy??content.resourcePolicy,signal,check,complete:false,headerOnly:true,budget:segmentedBudget(content,policy,budget)},resolved=await resolveScalarDefinitions(materials,content,options),context=await segmentedContext(materials,resolved,options);
  if(segment){
   if(!validClockSynchronizationSegment(segment))fail();const selected=await resolveScalarDefinitions(materials,segment,options);segmentBounds(selected,options);
   const doc=await materials.read(content.source.ref);for(const endpoint of [selected.range.first,selected.range.last]){await current(options);const page=await materials.retainedDatasetPage(doc,endpoint.page,{metadataOnly:true});await current(options);if(!page.rows[endpoint.row])fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');}
   if(anchor){
    if(!validClockSynchronizationAnchor(anchor,content)||compareSynchronizationRows(anchor.source.selector,selected.range.first)<0||compareSynchronizationRows(anchor.source.selector,selected.range.last)>0)fail('MEASUREMENT_CLOCK_SYNCHRONIZATION_ANCHOR');
    const left=await selectedCell(materials,anchor.source,{...options,segmented:true}),right=await selectedCell(materials,anchor.reference,options);
    v2run(options,b=>{scalar(left.cell,left.column,b);scalar(right.cell,right.column,b);});
   }
  }
  await current(options);return context;
 }catch(error){handled(error);}
}
