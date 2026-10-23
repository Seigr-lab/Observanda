import {retainDomainComponents,validateDomainValue,verifyDomainValue} from './measurement-domain-storage.js';
import {withDatasetPreparationWrites} from './dataset-preparation-writes.js';
import {calculatorResultColumn,calculatorResultDomainComponents} from './calculator-result-values.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {enqueueDataset} from './dataset-jobs.js';
import {jobSummary} from './jobs.js';
import {captureCalculatorRecipe,evaluateCalculatorRecipe} from './calculator-result-evaluation.js';
import {CALCULATOR_RECIPE_TOOL,validCalculatorSource,validCalculatorRecipe,validCalculatorResult,isCalculatorRecipe} from './web/calculator-result-model.js';
import {defaultColumn} from './web/dataset-schema.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {materialReference,materialReferenceKey} from './web/material-reference.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const fail=(code='CALCULATOR_RESULT_INVALID')=>{throw new AppError(code);};
const title=v=>typeof v==='string'&&v.trim()&&v.length<=300;
const validIntent=v=>exact(v,['recordId','title','id','expectedRevision'])&&researchId(v.recordId)&&title(v.title)&&researchId(v.id)&&(v.expectedRevision===null||revisionId(v.expectedRevision));
const intentFor=c=>({recordId:c.recordId,title:c.title,id:c.resultId??c.jobId,expectedRevision:c.resultRevision??null});
const capturedCommand=(doc,ref)=>({...doc.content.capture.intent,calculatorResult:{version:doc.content.recipe.version,recipe:materialReference(ref)}});
const column=()=>({...defaultColumn({label:'Result'}),representation:'rational',quantity:{origin:'derived',conversion:null,calibration:null}});
export class CalculatorResults{
 constructor(materials,{enqueue=enqueueDataset}={}){this.materials=materials;this.enqueue=enqueue;}
 async read(ref){const doc=await this.materials.read(ref);if(doc.kind!=='analysis'||!exact(doc.content,['tool','version','parameters','inputs','recipe','capture'])||!isCalculatorRecipe(doc.content)||!validCalculatorRecipe(doc.content.recipe)||doc.content.parameters!==doc.content.recipe.expression||!exact(doc.content.capture,['id','fingerprint','intent'])||!researchId(doc.content.capture.id)||!revisionId(doc.content.capture.fingerprint)||!validIntent(doc.content.capture.intent)||doc.content.capture.intent.recordId!==doc.recordId||!Array.isArray(doc.content.inputs)||doc.content.inputs.length!==0)fail();return doc;}
 async owner(workspaceId,recordId,{write=false}={}){if((await this.materials.workspace.outline()).metadata.id!==workspaceId)fail('WORKSPACE_CHANGED');await this.materials.assertOwner(recordId,{write});}
 async validate(command){
  if(!validCalculatorResult(command.calculatorResult)||!researchId(command.recordId)||!title(command.title)||!researchId(command.id)||command.expectedRevision!==null&&!revisionId(command.expectedRevision)||['artifact','baseDataset','calculation','aggregation','columns','columnChanges','exclusions','nativeMapping'].some(key=>command[key]!==undefined))fail();
  await this.materials.assertOwner(command.recordId);const recipe=await this.read(command.calculatorResult.recipe);if(command.calculatorResult.version!==recipe.content.recipe.version||recipe.recordId!==command.recordId||revisionText(command)!==revisionText(capturedCommand(recipe,command.calculatorResult.recipe)))fail();
  const current=await this.materials.current(command.id);if((current?.revision??null)!==command.expectedRevision||current&&(current.kind!=='dataset'||current.recordId!==command.recordId))fail('MATERIAL_CHANGED');return recipe;
 }
 async preview(command){const doc=await this.validate(command),value=evaluateCalculatorRecipe(doc.content.recipe);return {columns:['Result'],rows:[{cells:[value.structured?{format:'domain-preview',text:value.result.slice(0,4096),complete:value.result.length<=4096}:value.spelling],valueKinds:['string'],excluded:null}],columnOffset:0,columnCount:1,nextColumn:null};}
 async prepare(command,{signal,writePage,progress}={}){
  const doc=await this.validate(command);signal?.throwIfAborted();const result=evaluateCalculatorRecipe(doc.content.recipe),recipe=materialReference(command.calculatorResult.recipe);
  if(doc.content.recipe.version===2)return this.prepareStructured(command,doc,result,{signal,writePage,progress});
  async function* rows(){yield {columns:['Result'],sourceMapping:{format:'calculator-result',version:1}};yield {order:1,locator:{format:'calculator-result',version:1},cells:[result.spelling],valueKinds:['string'],cellSources:[[{ref:recipe,selector:{kind:'whole'}}]],excluded:null};}
  const prepared=await this.materials.prepareDatasetRows(command,{signal,writePage,progress,source:{doc:{id:doc.id}},rows:rows(),calculatedColumns:[column()],inputReferences:[recipe]});
  return {...prepared,content:{...prepared.content,calculatorResult:structuredClone(command.calculatorResult),algorithm:'observanda-calculator-result',algorithmVersion:1}};
 }
 async prepareStructured(command,doc,result,options){return this.materials.workspace.withCatalogueConnections(()=>withDatasetPreparationWrites(this.materials,options,async materials=>{
  const recipe=materialReference(command.calculatorResult.recipe),column=calculatorResultColumn(doc.content.recipe,result),write=fn=>fn();
  async function* rows(){yield {columns:['Result'],sourceMapping:{format:'calculator-result',version:2}};const value=result.structured?await retainDomainComponents(materials,column.domain,calculatorResultDomainComponents(result),write,{signal:options.signal}):result.spelling;yield {order:1,locator:{format:'calculator-result',version:2},cells:[value],valueKinds:['string'],cellSources:[[{ref:recipe,selector:{kind:'whole'}}]],excluded:null};}
  const prepared=await materials.prepareDatasetRows(command,{...options,preparedWrites:true,source:{doc:{id:doc.id}},rows:rows(),calculatedColumns:[column],inputReferences:[recipe]});return {...prepared,content:{...prepared.content,calculatorResult:structuredClone(command.calculatorResult),algorithm:'observanda-calculator-result',algorithmVersion:2}};
 }));}
 async resultReference(recipe){return {version:(await this.read(recipe)).content.recipe.version,recipe};}
 async replay(queue,id,fingerprint){const job=await queue.read(id);if(!job)return null;await queue.authorize(job);if(job.type!=='dataset.prepare'||!validCalculatorResult(job.input?.command?.calculatorResult))fail('MODULE_REPLAY');const recipe=await this.read(job.input.command.calculatorResult.recipe);if(recipe.content.capture.id!==id||recipe.content.capture.fingerprint!==fingerprint||job.scope!==recipe.content.capture.intent.recordId||revisionText(job.input.command)!==revisionText(capturedCommand(recipe,job.input.command.calculatorResult.recipe)))fail('MODULE_REPLAY');return {recipe:materialReference(job.input.command.calculatorResult.recipe),job:jobSummary(job)};}
 async retain(queue,command,{readSource,check=async()=>{},signal}={}){
  if(!exact(command,['workspaceId','recordId','title','source','expressionIndex','recipeId','jobId'])||!researchId(command.workspaceId)||!researchId(command.recordId)||!title(command.title)||!validCalculatorSource(command.source)||!researchId(command.recipeId)||!researchId(command.jobId)||command.recipeId===command.jobId||!Number.isSafeInteger(command.expressionIndex)||command.expressionIndex<0||command.expressionIndex>=100)fail();
  await check();signal?.throwIfAborted();const fingerprint=digest(serialize(command));await this.owner(command.workspaceId,command.recordId,{write:true});const replay=await this.replay(queue,command.jobId,fingerprint);if(replay){await check();await this.owner(command.workspaceId,command.recordId,{write:true});signal?.throwIfAborted();return replay;}let recipe=await this.captured(command.recipeId,command.jobId,fingerprint);
  if(!recipe){if(typeof readSource!=='function')fail('ACCESS_LOCKED');const source=await readSource(command.source,{signal});try{await check();signal?.throwIfAborted();const captured=captureCalculatorRecipe(command.source,source.entity,command.expressionIndex);evaluateCalculatorRecipe(captured);await source.verify();recipe=await this.commitRecipe(command,{recipe:captured,fingerprint,expectedRevision:null,check:async()=>{await source.verify();await check();signal?.throwIfAborted();}});}finally{await source.close();}}
  await check();signal?.throwIfAborted();const job=await this.enqueue(this.materials,queue,{recordId:command.recordId,title:command.title,id:command.jobId,expectedRevision:null,calculatorResult:await this.resultReference(recipe)},command.jobId);return {recipe,job};
 }
 async captured(id,jobId,fingerprint){const head=await this.materials.current(id);if(!head)return null;const doc=await this.read(head);if(doc.content.capture.id!==jobId)return null;if(doc.content.capture.fingerprint!==fingerprint)fail('MODULE_REPLAY');return materialReference(head);}
 async commitRecipe(command,{recipe,fingerprint,expectedRevision,check}){return this.materials.workspace.withLock(async()=>{await check();await this.owner(command.workspaceId,command.recordId,{write:true});const replay=await this.captured(command.recipeId,command.jobId,fingerprint);if(replay)return replay;return this.materials.commit({kind:'analysis',id:command.recipeId,recordId:command.recordId,title:command.title.slice(0,293)+' recipe',expectedRevision,content:{tool:CALCULATOR_RECIPE_TOOL,version:String(recipe.version),parameters:recipe.expression,inputs:[],recipe,capture:{id:command.jobId,fingerprint,intent:intentFor(command)}}});});}
 async repeat(queue,command,{check=async()=>{},signal}={}){
  if(!exact(command,['workspaceId','ref','jobId'])||!researchId(command.workspaceId)||!researchId(command.jobId)||command.ref?.kind!=='dataset'||!researchId(command.ref.id)||!revisionId(command.ref.revision))fail();
  await check();signal?.throwIfAborted();const doc=await this.materials.read(command.ref);if(!validCalculatorResult(doc.content.calculatorResult))fail();await this.owner(command.workspaceId,doc.recordId,{write:true});const prior=await this.read(doc.content.calculatorResult.recipe),fingerprint=digest(serialize(command)),replay=await this.replay(queue,command.jobId,fingerprint);if(replay){await check();await this.owner(command.workspaceId,doc.recordId,{write:true});signal?.throwIfAborted();return replay;}
  let recipe=await this.captured(prior.id,command.jobId,fingerprint);
  if(!recipe){const current=await this.materials.current(doc.id);if(current?.revision!==command.ref.revision)fail('MATERIAL_CHANGED');evaluateCalculatorRecipe(prior.content.recipe);recipe=await this.commitRecipe({...command,recordId:doc.recordId,title:doc.title,recipeId:prior.id,resultId:doc.id,resultRevision:command.ref.revision},{recipe:structuredClone(prior.content.recipe),fingerprint,expectedRevision:doc.content.calculatorResult.recipe.revision,check:async()=>{await check();signal?.throwIfAborted();}});}
  await check();signal?.throwIfAborted();const job=await this.enqueue(this.materials,queue,{recordId:doc.recordId,title:doc.title,id:doc.id,expectedRevision:command.ref.revision,calculatorResult:await this.resultReference(recipe)},command.jobId);return {recipe,job};
 }
 async resume(queue,command,{check=async()=>{},signal}={}){
  if(!exact(command,['workspaceId','ref'])||!researchId(command.workspaceId)||command.ref?.kind!=='analysis'||!researchId(command.ref.id)||!revisionId(command.ref.revision))fail();
  await check();signal?.throwIfAborted();const doc=await this.read(command.ref),capture=doc.content.capture;await this.owner(command.workspaceId,doc.recordId,{write:true});
  const replay=await this.replay(queue,capture.id,capture.fingerprint);await check();signal?.throwIfAborted();await this.owner(command.workspaceId,doc.recordId,{write:true});if(replay)return replay;
  const recipe=materialReference(command.ref),job=await this.enqueue(this.materials,queue,{...capture.intent,calculatorResult:await this.resultReference(recipe)},capture.id);return {recipe,job};
 }
 async verify(doc){
  if(isCalculatorRecipe(doc.content)){await this.read({kind:doc.kind,id:doc.id,revision:digest(revisionText(doc))});evaluateCalculatorRecipe(doc.content.recipe);return;}
  if(doc.kind!=='dataset'||!validCalculatorResult(doc.content.calculatorResult)||doc.content.algorithm!=='observanda-calculator-result'||doc.content.algorithmVersion!==doc.content.calculatorResult.version||doc.content.rowCount!==1||doc.content.includedRowCount!==1)fail('CATALOGUE_DAMAGED');
  const recipe=await this.read(doc.content.calculatorResult.recipe),expected=evaluateCalculatorRecipe(recipe.content.recipe),schema=await this.materials.retainedSchemaPage(doc,{offset:0,limit:2}),page=await this.materials.retainedDatasetPage(doc,0,{columns:[0]});
  if(doc.content.calculatorResult.version!==recipe.content.recipe.version||recipe.recordId!==doc.recordId||doc.id!==recipe.content.capture.intent.id||doc.title!==recipe.content.capture.intent.title||(doc.previous??null)!==recipe.content.capture.intent.expectedRevision||schema.total!==1||revisionText(schema.items[0])!==revisionText(recipe.content.recipe.version===2?calculatorResultColumn(recipe.content.recipe,expected):column())||page.rows.length!==1||page.rows[0].excluded||page.rows[0].valueKinds[0]!=='string')fail('CATALOGUE_DAMAGED');
  const cell=page.rows[0].cells[0];
  if(expected.structured){validateDomainValue(this.materials,cell,schema.items[0].domain);await verifyDomainValue(this.materials,cell);let index=0;for await(const part of this.materials.sequences.items(cell.components)){const expectedPart=expected.structured.components[index++];if(!expectedPart||await calculatorResultText(this.materials,part.spelling,expectedPart.numerator.length+expectedPart.denominator.length+1)!==expectedPart.numerator+'/'+expectedPart.denominator)fail('CATALOGUE_DAMAGED');}if(index!==expected.structured.components.length)fail('CATALOGUE_DAMAGED');}
  else if(await calculatorResultText(this.materials,cell,expected.spelling.length)!==expected.spelling)fail('CATALOGUE_DAMAGED');
  if(revisionText(page.rows[0].cellSources?.[0])!==revisionText([{ref:doc.content.calculatorResult.recipe,selector:{kind:'whole'}}]))fail('CATALOGUE_DAMAGED');
  const inputs=[];for await(const ref of this.materials.references(doc.content))inputs.push(materialReferenceKey(ref));if(inputs.length!==1||inputs[0]!==materialReferenceKey(doc.content.calculatorResult.recipe))fail('CATALOGUE_DAMAGED');
 }
}

export async function calculatorResultText(materials,value,limit,{signal}={}){if(typeof value==='string')return value;if(value?.format!=='dataset-cell'||value.characters>limit)fail('CATALOGUE_DAMAGED');let text='',offset=0;do{signal?.throwIfAborted();const page=await materials.readDatasetCell(value,{offset,limit:4096,signal});if(page.offset!==offset||page.total!==value.characters||page.next!==null&&page.next<=offset)fail('CATALOGUE_DAMAGED');text+=page.text;if(text.length>limit)fail('CATALOGUE_DAMAGED');offset=page.next;}while(offset!==null);return text;}
export async function calculatorResultScalar(materials,value,column,result,options={}){if(!validCalculatorResult(result))return false;const recipe=await new CalculatorResults(materials).read(result.recipe),expected=evaluateCalculatorRecipe(recipe.content.recipe);if(expected.structured||column.representation!=='rational'||column.radix!==10||column.unit!==''||await calculatorResultText(materials,value,expected.spelling.length,options)!==expected.spelling)fail('CALCULATOR_RESULT_INVALID');return true;}
