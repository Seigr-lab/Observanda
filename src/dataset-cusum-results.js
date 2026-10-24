// Exact CUSUM over one pinned, ordered scalar range. Execution work is owned by
// the existing lease-fenced numerical job ledger; only a complete result publishes.
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {digest} from './storage-format.js';
import {numericalOperation} from './dataset-resource-budget.js';
import {NumericalExecutionWork} from './numerical-execution-work.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {materialReference} from './web/material-reference.js';
import {defaultColumn} from './web/dataset-schema.js';
import {blankQuantity,isScalarRepresentation} from './web/measurement-model.js';
import {defaultDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {resolveCellComputation,effectiveCellColumn,validCellComputation} from './web/measurement-computation.js';
import {validPolicyScalar,validatePolicyScalar,isScalarResourceFailure,withScalarPolicy} from './web/measurement-scalar-policy.js';
import {blankUnitDefinition,validateUnitDefinition,unitScalar,sameUnitDimensions,multiplyUnitRational,divideUnitRational} from './web/measurement-unit-model.js';
import {plotRationalText} from './web/plot-resource-policy.js';
import {resolveScalarDefinitions,resolveScalarOperand,retainScalarDefinitions,scalarDefinitionEntries} from './measurement-scalar-storage.js';
import {readDatasetCell} from './dataset-cell-storage.js';
import {datasetColumnCount} from './dataset-selected-columns.js';
import {datasetRowPosition} from './dataset-row-position.js';
import {projectDatasetRows} from './dataset-storage.js';
import {DatasetCusumError,evaluateCusum,validCusumExecutionCursor} from './dataset-cusum-kernel.js';
import {CUSUM_ROLES,validCusumRecipe,cusumColumnDescriptor} from './web/dataset-cusum-model.js';
import messages from './web/locales/en/datasetCusum.json' with {type:'json'};
export const CUSUM_TOOL='Observanda dataset CUSUM';
const fail=(code='DATASET_CUSUM_INVALID')=>{throw new AppError(code);};
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const identity=value=>{const h=digest(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
const names=()=>[messages.columnPosition,messages.columnUpper,messages.columnLower,messages.columnUpperCrossing,messages.columnLowerCrossing,messages.columnUpperStart,messages.columnLowerStart,messages.columnStatus,messages.columnReset];
const scalar=spelling=>({spelling,representation:'rational',radix:10});
const computedIndices=[1,2,3,4,5,6,8];
const bounded=value=>typeof value==='string'&&value.length>4096?{format:'scalar-preview',text:value.slice(0,4096),complete:false}:value;
const previewUnit=value=>({...value,scale:{...value.scale,spelling:bounded(value.scale.spelling)},offset:{...value.offset,spelling:bounded(value.offset.spelling)}});
function handled(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;if(error instanceof DatasetCusumError)fail(error.code);throw error;}
function summaryShape(summary,recipe){
 return exact(summary,['version','method','count','firstOrdinal','lastOrdinal','upperCrossings','lowerCrossings','missing','excluded','approximateInputs','resourcePolicy','executionPolicy','outputDigest'])&&summary.version===1&&summary.method===recipe.method&&summary.count===recipe.range.count&&summary.firstOrdinal===recipe.range.start&&summary.lastOrdinal===recipe.range.start+recipe.range.count-1&&['upperCrossings','lowerCrossings','missing','excluded'].every(key=>natural(summary[key])&&summary[key]<=summary.count)&&summary.missing+summary.excluded<=summary.count&&(recipe.gaps!=='reject'||summary.missing+summary.excluded===0)&&summary.upperCrossings+summary.lowerCrossings<=summary.count-summary.missing-summary.excluded&&typeof summary.approximateInputs==='boolean'&&(summary.missing+summary.excluded<summary.count||!summary.approximateInputs)&&revisionText(summary.resourcePolicy)===revisionText(recipe.resourcePolicy)&&revisionText(summary.executionPolicy)===revisionText(recipe.executionPolicy)&&typeof summary.outputDigest==='string'&&/^[a-f0-9]{64}$/.test(summary.outputDigest);
}
function analysisShape(doc){
 const c=doc?.content;if(doc?.kind!=='analysis'||!exact(c,['tool','version','cusum','summary','inputs','capture'])||c.tool!==CUSUM_TOOL||c.version!==1||!validCusumRecipe(c.cusum)||!summaryShape(c.summary,c.cusum)||revisionText(c.inputs)!==revisionText([c.cusum.source])||!exact(c.capture,['id','expectedRevision','title','columnNames'])||!researchId(c.capture.id)||c.capture.expectedRevision!==null&&!revisionId(c.capture.expectedRevision)||typeof c.capture.title!=='string'||!c.capture.title.trim()||c.capture.title.length>300||!Array.isArray(c.capture.columnNames)||c.capture.columnNames.length!==9||c.capture.columnNames.some(name=>typeof name!=='string'||!name.trim()||name.length>200))fail('MATERIAL_MISSING');
}
const receiptKeys=['version','index','ordinal','status','reason','aboveUpper','aboveLower','crossedUpper','crossedLower','upperExtent','lowerExtent','resetAfter','upperComputation','lowerComputation','crossedUpperComputation','crossedLowerComputation','resetComputation'];
export function validCusumReceipt(value,recipe){
 if(!recipe?.range||!natural(recipe.range.start)||!Number.isSafeInteger(recipe.range.count)||recipe.range.count<1||!Number.isSafeInteger(recipe.range.start+recipe.range.count)||!['reject','reset-both'].includes(recipe.gaps)||!['continue','reset-both-after-row'].includes(recipe.afterSignal))return false;
 if(!exact(value,receiptKeys)||value.version!==1||!natural(value.index)||value.index>=recipe.range.count||value.ordinal!==recipe.range.start+value.index||!['value','missing','excluded'].includes(value.status)||value.reason!==null&&(typeof value.reason!=='string'||value.reason.length>1000))return false;
 for(const key of ['aboveUpper','aboveLower','crossedUpper','crossedLower','resetAfter'])if(typeof value[key]!=='boolean')return false;
 for(const key of ['upperComputation','lowerComputation','crossedUpperComputation','crossedLowerComputation','resetComputation'])if(!validCellComputation(value[key])||value[key]!==null&&value[key].kind!=='approximate-inputs')return false;
 for(const key of ['upperExtent','lowerExtent']){const extent=value[key];if(extent!==null&&(!exact(extent,['first','last'])||!natural(extent.first)||extent.first<recipe.range.start||extent.first>value.ordinal||extent.last!==value.ordinal))return false;}
 if(value.crossedUpper&&value.crossedLower)return false;
 for(const direction of ['Upper','Lower']){const score=value[direction.toLowerCase()+'Computation'],crossing=value['crossed'+direction+'Computation'];if(score!==null&&crossing===null||!value['above'+direction]&&!!score!==!!crossing)return false;}
 if(value.crossedUpper&&!value.aboveUpper||value.crossedLower&&!value.aboveLower||value.aboveUpper&&value.upperExtent===null||value.aboveLower&&value.lowerExtent===null)return false;
 if(value.status!=='value')return recipe.gaps==='reset-both'&&value.resetAfter&&!value.aboveUpper&&!value.aboveLower&&!value.crossedUpper&&!value.crossedLower&&value.upperExtent===null&&value.lowerExtent===null&&['upperComputation','lowerComputation','crossedUpperComputation','crossedLowerComputation','resetComputation'].every(key=>value[key]===null);
 return value.resetAfter===(recipe.afterSignal==='reset-both-after-row'&&(value.crossedUpper||value.crossedLower))&&!!value.resetComputation===(recipe.afterSignal==='reset-both-after-row'&&(!!value.crossedUpperComputation||!value.crossedUpper&&!!value.crossedLowerComputation));
}
function projectedOutput(row){
 const {upper,lower,...metadata}=row,cusum={version:1,...metadata},values=[String(row.ordinal+1),upper?.spelling??null,lower?.spelling??null,row.crossedUpper?'1':'0',row.crossedLower?'1':'0',row.upperExtent===null?null:String(row.upperExtent.first+1),row.lowerExtent===null?null:String(row.lowerExtent.first+1),row.status,row.resetAfter?'1':'0'];
 return {values,cells:values.map(value=>value??''),valueKinds:values.map(value=>value===null?'absent':'string'),cellComputations:[undefined,row.upperComputation,row.lowerComputation,row.crossedUpperComputation,row.crossedLowerComputation,row.upperComputation,row.lowerComputation,undefined,row.resetComputation],cusum};
}
const outputKeys=[...receiptKeys.filter(key=>key!=='version'),'upper','lower'];
function validOutput(row,recipe){
 if(!exact(row,outputKeys))return false;const {upper,lower,...metadata}=row;if(!validCusumReceipt({version:1,...metadata},recipe))return false;
 for(const direction of ['upper','lower']){const value=row[direction];if(row.status!=='value'){if(value!==null)return false;continue;}if(!validPolicyScalar(value,recipe.resourcePolicy)||typeof value.spelling!=='string'||value.representation!=='rational'||value.radix!==10||value.spelling!=='0/1'&&!/^[1-9]\d*\/[1-9]\d*$/.test(value.spelling)||(value.spelling==='0/1')!==(row[direction+'Extent']===null))return false;}
 return true;
}
// All post-computation consumers share this bounded, keyed read. Storage may
// return batches in any order; absent, extra or malformed records are refused.
export async function* cusumOutputs(work,recipe,{offset=0,count,signal,check}={}){
 if(!validCusumRecipe(recipe)||typeof work?.getMany!=='function'||!natural(offset)||offset>recipe.range.count)fail();count??=recipe.range.count-offset;if(!natural(count)||!Number.isSafeInteger(offset+count)||offset+count>recipe.range.count)fail();
 for(let at=offset;at<offset+count;at+=32){signal?.throwIfAborted();await check?.();const length=Math.min(32,offset+count-at),keys=Array.from({length},(_,index)=>'output:'+(at+index)),batch=await work.getMany(keys);signal?.throwIfAborted();await check?.();if(!(batch instanceof Map)||batch.size!==keys.length||keys.some(key=>!batch.has(key)))fail('MATERIAL_MISSING');
  for(let index=0;index<keys.length;index++){signal?.throwIfAborted();const row=batch.get(keys[index]);if(!validOutput(row,recipe)||row.index!==at+index)fail('MATERIAL_MISSING');yield row;}
 }
}
export function cusumColumns(context,analysis,columnNames=names()){
 const {recipe}=context;return CUSUM_ROLES.map((role,index)=>({...defaultColumn({label:columnNames[index]}),representation:index===7?'text':[1,2].includes(index)?'rational':'integer',radix:10,...(index===7?{}:{resourcePolicy:structuredClone(recipe.resourcePolicy),quantity:{...blankQuantity(),origin:'derived',unitDefinition:structuredClone([1,2].includes(index)?recipe.unitDefinition:blankUnitDefinition())}}),cusum:cusumColumnDescriptor(recipe,analysis,role),...(computedIndices.includes(index)?{computation:{version:2,kind:'per-cell'}}:{})}));
}
// Pinned page metadata is bounded; project only the selected row and column.
function selectedReader(materials,context){let cached=null,fallbackStart=0,fallbackPage=0;
 return async(index,{signal}={})=>{
  signal?.throwIfAborted();if(!natural(index)||index>=context.recipe.range.count)fail();const absolute=context.recipe.range.start+index;let position=await datasetRowPosition(materials,context.doc,{offset:absolute,includeExcluded:true});
  if(!position){if(!cached||absolute<fallbackStart){cached=null;fallbackStart=0;fallbackPage=0;}for(;;){if(!cached||cached.page!==fallbackPage)cached=await materials.retainedDatasetPage(context.doc,fallbackPage,{metadataOnly:true});if(absolute<fallbackStart+cached.rows.length){position={page:fallbackPage,row:absolute-fallbackStart};break;}fallbackStart+=cached.rows.length;fallbackPage++;if(fallbackPage>=materials.datasetPageCount(context.doc))fail('MATERIAL_MISSING');cached=null;}}
  if(!cached||cached.page!==position.page)cached=await materials.retainedDatasetPage(context.doc,position.page,{metadataOnly:true});const row=cached.rows[position.row];if(!row)fail('MATERIAL_MISSING');const projected=(await projectDatasetRows(materials,context.doc,[row],[context.recipe.column])).rows[0];if(!projected)fail('MATERIAL_MISSING');return {row:projected,page:position.page,position:position.row,index};
 };
}
function selectedCell(row,index=0){const cell={value:row.cells[index],kind:row.valueKinds?.[index]??'string'};if(row.cellComputations?.[index]!==undefined)cell.computation=row.cellComputations[index];return cell;}
// Cached exact unit ratios retain original declaration policies. Conversions do
// not reinterpret an expanded internal rational as a newly authored spelling.
function convertParsedDifferenceUnit(value,from,to,budget){const run=(unit,operation)=>unit.definition.version===2?withScalarPolicy(unit.definition.resourcePolicy,budget,operation):operation(budget),canonical=run(from,b=>multiplyUnitRational(value,from.scale,b));return run(to,b=>divideUnitRational(canonical,to.scale,b));}
export async function prepareCusumScalars(materials,command,{write,signal,base,allowRetained=false}={}){
 if(!command.cusum)return command;if(!validCusumRecipe(command.cusum))fail();await materials.assertOwner(command.recordId);
 if(!base&&command.id&&command.expectedRevision){const doc=await materials.read({kind:'dataset',id:command.id,revision:command.expectedRevision});if(doc.recordId!==command.recordId||!doc.content.cusum)fail();base=(await new DatasetCusumResults(materials).analysis(doc.content.cusum.analysis)).content.cusum;}
 const prior=scalarDefinitionEntries(base).map(entry=>entry.scalar.spelling);for(const entry of scalarDefinitionEntries(command.cusum))if(typeof entry.scalar.spelling!=='string'&&!allowRetained&&!prior.some(value=>revisionText(value)===revisionText(entry.scalar.spelling)))fail();
 return {...command,cusum:write?await retainScalarDefinitions(materials,command.cusum,write,{signal,allowRetained:true}):command.cusum};
}
export class DatasetCusumResults{
 constructor(materials){if(!materials?.workspace||!materials.sequences||typeof materials.read!=='function'||typeof materials.assertOwner!=='function')fail();this.materials=materials;}
 scoped(operation){const workspace=this.materials.workspace;return workspace.withCatalogueConnections?workspace.withCatalogueConnections(operation):operation();}
 async validate(command){
  if(!validCusumRecipe(command.cusum)||!researchId(command.recordId)||!researchId(command.id)||command.expectedRevision!==null&&!revisionId(command.expectedRevision)||typeof command.title!=='string'||!command.title.trim()||command.title.length>300||['artifact','baseDataset','calculation','calculatorResult','aggregation','uncertainty','spectrum','columns','columnChanges','sourceMapping','nativeMapping','exclusions'].some(key=>command[key]!==undefined))fail();
  await this.materials.assertOwner(command.recordId);const current=await this.materials.current(command.id);if((current?.revision??null)!==command.expectedRevision||current&&(current.kind!=='dataset'||current.recordId!==command.recordId))fail('MATERIAL_CHANGED');const doc=await this.materials.read(command.cusum.source);if(command.cusum.column>=datasetColumnCount(doc)||command.cusum.range.start+command.cusum.range.count>doc.content.rowCount)fail();
 }
 async scopedContext(recipe,execution,{signal}={}){
  if(!validCusumRecipe(recipe))fail();const m=this.materials,cursor=execution.cursor,part=async operation=>{let result;await execution.slice(cursor,async({budget})=>{result=await operation(budget.scalarBudget(recipe.resourcePolicy));return cursor;});return result;};
  const resolved=await part(budget=>resolveScalarDefinitions(m,recipe,{signal,budget})),doc=await m.read(recipe.source);if(recipe.column>=datasetColumnCount(doc)||recipe.range.start+recipe.range.count>doc.content.rowCount)fail();const sourceDeclaration=await m.datasetColumn(doc,recipe.column),sourceColumn=await part(budget=>resolveScalarDefinitions(m,sourceDeclaration,{signal,budget}));if(!isScalarRepresentation(sourceColumn))fail('DATASET_CUSUM_INPUT');
  const parsedUnit=async definition=>{try{if(!definition||definition.kind!=='difference')fail('DATASET_CUSUM_UNITS');await part(budget=>numericalOperation(budget,b=>validateUnitDefinition(definition,{budget:b})));const result={definition};for(const field of ['scale','offset'])result[field]=await part(budget=>numericalOperation(budget,b=>unitScalar(definition[field],b,definition.resourcePolicy)));if(result.offset.numerator!==0n||result.scale.numerator<=0n)fail('DATASET_CUSUM_UNITS');return result;}catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail('DATASET_CUSUM_UNITS');}};
  const sourceUnit=await parsedUnit(sourceColumn.quantity?.unitDefinition),parameterUnit=await parsedUnit(resolved.unitDefinition);if(!sameUnitDimensions(sourceUnit.definition,parameterUnit.definition))fail('DATASET_CUSUM_UNITS');const context={recipe:resolved,doc,sourceDeclaration,sourceColumn,sourceUnit,parameterUnit};context.read=selectedReader(m,context);return context;
 }
 async operand(context,index,{signal,budget}={}){
  const m=this.materials,item=await context.read(index,{signal}),column=context.sourceColumn,cell=selectedCell(item.row),ordinal=context.recipe.range.start+index,computation=resolveCellComputation(column,cell);if(item.row.excluded!==null&&item.row.excluded!==undefined)return {ordinal,kind:'excluded',reason:item.row.excluded};
  const missing=typeof cell.value==='string'?column.missing.find(entry=>entry.value===cell.value):null;if(['null','absent'].includes(cell.kind)||missing)return {ordinal,kind:'missing',...(missing?{reason:missing.meaning}:{})};
  const actual=effectiveCellColumn(column,cell),resolved=await resolveScalarOperand(m,cell,actual,{signal,budget,policy:context.recipe.resourcePolicy}),sourceScalar={spelling:resolved.value,representation:column.representation,radix:column.radix},resourcePolicy=column.resourcePolicy??defaultDatasetResourcePolicy();let converted;
  try{converted=numericalOperation(budget,b=>plotRationalText(convertParsedDifferenceUnit(validatePolicyScalar(sourceScalar,resourcePolicy,{budget:b}),context.sourceUnit,context.parameterUnit,b),b));}catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail('DATASET_CUSUM_INPUT');}
  return {ordinal,kind:'value',scalar:scalar(converted),sourceScalar,resourcePolicy,computation};
 }
 async scopedEvaluation(command,scratch,{signal,check,progress=async()=>{},writePage,jobId,durable=false}={}){
  const recipe=command?.cusum,m=this.materials;if(!validCusumRecipe(recipe)||!researchId(command.recordId)||!researchId(command.id)||durable&&(!researchId(jobId)||typeof writePage!=='function'))fail();const execution=new NumericalExecutionWork(m,command,{kind:'cusum',jobId:jobId??identity('numerical-cusum:'+digest(revisionText(command))),writePage,signal,check:async()=>{await check?.();await m.assertOwner(command.recordId);await m.read(recipe.source);},validCursor:value=>validCusumExecutionCursor(value,recipe.range.count),...(durable?{}:{scratch})});await execution.open();const context=await this.scopedContext(recipe,execution,{signal});let summary;
  try{summary=await evaluateCusum({count:recipe.range.count,read:(index,options)=>this.operand(context,index,options),write:async(row,{work})=>{if(!validOutput(row,recipe))fail('MATERIAL_MISSING');await work.put('output:'+row.index,row);}},{...context.recipe,execution,signal,check,progress:value=>progress({stage:messages.progressCalculation,done:value.done,total:value.total})});}catch(error){handled(error);}
  const hash=createHash('sha256');for await(const row of cusumOutputs(execution,context.recipe,{signal,check})){hash.update(revisionText(row));hash.update('\n');}return {context,work:execution,summary:{...summary,outputDigest:hash.digest('hex')}};
 }
 async analysis(ref){const doc=await this.materials.read(ref);analysisShape(doc);await this.materials.assertOwner(doc.recordId);return doc;}
 async retainAnalysis(command,summary,{signal,writePage}={}){
  const m=this.materials,write=writePage??(operation=>m.workspace.withLock(operation)),id=identity('dataset-cusum:'+command.id+':'+command.expectedRevision);return write(async()=>{signal?.throwIfAborted();await m.assertOwner(command.recordId,{write:true});await m.read(command.cusum.source);const previous=await m.current(id),prior=previous?await this.analysis(previous):null,content=await retainScalarDefinitions(m,{tool:CUSUM_TOOL,version:1,cusum:command.cusum,summary,inputs:[command.cusum.source],capture:{id:command.id,expectedRevision:command.expectedRevision,title:command.title,columnNames:prior?.content.capture.columnNames??names()}},fn=>fn(),{signal,allowRetained:true});if(!summaryShape(summary,command.cusum))fail('MATERIAL_MISSING');if(previous){if(prior.recordId!==command.recordId||revisionText(prior.content)!==revisionText(content))fail('MATERIAL_CHANGED');return materialReference(previous);}return m.commit({kind:'analysis',recordId:command.recordId,title:messages.recipeTitle.replace('{title}',command.title.slice(0,260)),id,expectedRevision:null,content});});
 }
 async *rows(context,work,analysis,columns,{signal}={}){
  yield {columns:columns.map(column=>column.name),sourceMapping:{format:'cusum',version:1}};for await(const row of cusumOutputs(work,context.recipe,{signal})){const index=row.index,output=projectedOutput(row);yield {order:index+1,locator:{format:'cusum',version:1,index},cells:output.cells,valueKinds:output.valueKinds,cellComputations:output.cellComputations,cellSources:columns.map(()=>[{ref:analysis,selector:{kind:'whole'}}]),cusum:output.cusum,excluded:null};}
 }
 async prepare(command,options={}){return this.scoped(()=>withScratch(async scratch=>{
  const commandHash=digest(revisionText(command));command=await prepareCusumScalars(this.materials,command,{...options,write:options.writePage??(fn=>this.materials.workspace.withLock(fn)),allowRetained:!!options.jobId});await this.validate(command);const {context,work,summary}=await this.scopedEvaluation(command,scratch,{...options,durable:!!options.jobId}),analysis=await this.retainAnalysis(command,summary,options),saved=await this.analysis(analysis),columns=cusumColumns(context,analysis,saved.content.capture.columnNames),result=await this.materials.prepareDatasetRows(command,{...options,source:{doc:{id:command.id}},rows:this.rows(context,work,analysis,columns,options),calculatedColumns:columns,inputReferences:[command.cusum.source,analysis]});return {...result,commandHash,content:{...result.content,cusum:{version:1,analysis},algorithm:'observanda-dataset-cusum',algorithmVersion:1}};
 },options));}
 async preview(command,options={}){return this.scoped(()=>withScratch(async scratch=>{
  command=await prepareCusumScalars(this.materials,command,options);command={...command,id:command.id??randomUUID(),expectedRevision:command.expectedRevision??null};await this.validate(command);const {context,work,summary}=await this.scopedEvaluation(command,scratch,options),rows=[];
  for await(const row of cusumOutputs(work,context.recipe,{count:Math.min(5,context.recipe.range.count),signal:options.signal,check:options.check})){const output=projectedOutput(row);rows.push({cells:output.values.map(bounded),valueKinds:output.valueKinds,computations:output.cellComputations.map(value=>value??null),cusum:output.cusum,excluded:null});}
  return {columns:names(),rows,summary,cusum:context.recipe,columnOffset:0,columnCount:9,nextColumn:null,contexts:CUSUM_ROLES.map((role,index)=>({representation:index===7?'text':[1,2].includes(index)?'rational':'integer',radix:10,...(index===7?{}:{unitDefinition:previewUnit([1,2].includes(index)?context.recipe.unitDefinition:blankUnitDefinition())})}))};
 },options));}
 async inputs({ref,offset=0,limit=16},{signal}={}){return this.scoped(async()=>{
  let doc=await this.materials.read(ref);if(doc.kind==='dataset'){if(!doc.content.cusum)fail();ref=doc.content.cusum.analysis;}doc=await this.analysis(ref);const recipe=doc.content.cusum;if(!natural(offset)||offset>recipe.range.count||!Number.isSafeInteger(limit)||limit<1||limit>16)fail();const sourceDoc=await this.materials.read(recipe.source),column=await this.materials.datasetColumn(sourceDoc,recipe.column);if(recipe.column>=datasetColumnCount(sourceDoc)||recipe.range.start+recipe.range.count>sourceDoc.content.rowCount)fail('MATERIAL_MISSING');const context={recipe,doc:sourceDoc};context.read=selectedReader(this.materials,context);const items=[];
  for(let index=offset;index<Math.min(offset+limit,recipe.range.count);index++){signal?.throwIfAborted();const item=await context.read(index,{signal}),cell=selectedCell(item.row);items.push({index,source:{ref:recipe.source,selector:{kind:'cell',page:item.page,row:item.position,column:recipe.column}},column,value:bounded(cell.value),kind:cell.kind,computation:resolveCellComputation(column,cell),excluded:item.row.excluded??null});}
  return {ref:materialReference(ref),title:doc.title,recordId:doc.recordId,cusum:recipe,summary:doc.content.summary,items,offset,total:recipe.range.count,next:offset+items.length<recipe.range.count?offset+items.length:null};
 });}
 async verify(doc,{signal}={}){return this.scoped(()=>withScratch(async scratch=>{
  const m=this.materials,analysis=doc.content.tool===CUSUM_TOOL?doc:doc.kind==='dataset'&&exact(doc.content.cusum,['version','analysis'])&&doc.content.cusum.version===1?await this.analysis(doc.content.cusum.analysis):null;if(!analysis)fail('MATERIAL_MISSING');analysisShape(analysis);const saved=analysis.content,{context,summary,work}=await this.scopedEvaluation({recordId:analysis.recordId,...saved.capture,cusum:saved.cusum},scratch,{signal});if(revisionText(summary)!==revisionText(saved.summary))fail('MATERIAL_MISSING');if(doc===analysis)return;
  const c=doc.content,ref=materialReference(c.cusum.analysis);if(c.algorithm!=='observanda-dataset-cusum'||c.algorithmVersion!==1||c.rowCount!==context.recipe.range.count||c.includedRowCount!==c.rowCount||analysis.recordId!==doc.recordId||saved.capture.id!==doc.id||saved.capture.expectedRevision!==(doc.previous??null)||saved.capture.title!==doc.title||datasetColumnCount(doc)!==9)fail('MATERIAL_MISSING');const columns=cusumColumns(context,ref,saved.capture.columnNames);for(let index=0;index<9;index++)if(revisionText(await resolveScalarDefinitions(m,await m.datasetColumn(doc,index),{signal}))!==revisionText(columns[index]))fail('MATERIAL_MISSING');let count=0;const replayRows=cusumOutputs(work,context.recipe,{signal});
  for(let page=0;page<m.datasetPageCount(doc);page++)for(const row of (await m.retainedDatasetPage(doc,page,{columns:[0,1,2,3,4,5,6,7,8]})).rows){signal?.throwIfAborted();const next=await replayRows.next();if(next.done)fail('MATERIAL_MISSING');const expected=projectedOutput(next.value);if(row.order!==count+1||revisionText(row.locator)!==revisionText({format:'cusum',version:1,index:count})||row.excluded||revisionText(row.cusum)!==revisionText(expected.cusum)||revisionText(row.valueKinds)!==revisionText(expected.valueKinds)||revisionText(row.cellSources)!==revisionText(columns.map(()=>[{ref,selector:{kind:'whole'}}])))fail('MATERIAL_MISSING');
   for(let index=0;index<9;index++){let offset=0;do{const part=await readDatasetCell(m,row.cells[index],{offset,limit:4096,signal});if(part.total!==expected.cells[index].length||part.text!==expected.cells[index].slice(offset,offset+part.text.length))fail('MATERIAL_MISSING');offset=part.next;}while(offset!==null);if(computedIndices.includes(index)){if(revisionText(resolveCellComputation(columns[index],selectedCell(row,index)))!==revisionText(expected.cellComputations[index]))fail('MATERIAL_MISSING');}else if(row.cellComputations?.[index]!==undefined)fail('MATERIAL_MISSING');}count++;
  }if(count!==c.rowCount||!(await replayRows.next()).done)fail('MATERIAL_MISSING');
 },{signal}));}
}
