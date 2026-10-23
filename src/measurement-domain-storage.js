import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
// Native domain cells retain their complete original and a paged exact interpretation.
// This adapter uses the existing material sequences and streaming JSON tokenizer.
import {parseIntervalBounds} from './measurement-interval.js';
import {validIntervalDomain} from './web/measurement-interval-model.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {datasetJSONTokens} from './dataset-json-tokens.js';
import {readDatasetCell,retainDatasetCell,datasetCellReference,verifyDatasetCell} from './dataset-cell-storage.js';
import {exactRational} from './web/measurement-rational.js';
import {validDomainDefinition,knownDomain,domainCodec,domainComponentCount,domainComponentPosition,sameDomainSpace} from './web/measurement-domain-model.js';
import {revisionText} from './web/revision-model.js';
const fail=(code='MEASUREMENT_DOMAIN_INVALID')=>{throw new AppError(code);};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const domainValueReference=value=>exact(value,['format','version','definition','original','components','identity','complete'])&&value.format==='domain-value'&&[1,2,3].includes(value.version)&&validDomainDefinition(value.definition)&&(value.version!==2||validIntervalDomain(value.definition))&&(value.version===3?value.definition.version===2:value.definition.version===1)&&(typeof value.original==='string'||datasetCellReference(value.original))&&typeof value.complete==='boolean'&&(value.identity===null||hash(value.identity));
export const domainValueSupported=value=>knownDomain(value.definition)&&(domainCodec(value.definition)!=='interval'||[2,3].includes(value.version));
export function validateDomainValue(materials,value,definition=value?.definition){
 if(!domainValueReference(value)||revisionText(definition)!==revisionText(value.definition))fail('MATERIAL_MISSING');
 if(!domainValueSupported(value)){if(value.components!==null||value.identity!==null||value.complete)fail('MATERIAL_MISSING');return value;}
 if(domainCodec(definition)==='symbol'){if(value.components!==null||!value.complete||!hash(value.identity))fail('MATERIAL_MISSING');return value;}
 if(domainCodec(definition)==='interval'&&!value.complete)fail('MATERIAL_MISSING');materials.sequences.validate(value.components);if(value.components.kind!=='domain-components'||value.components.count!==domainComponentCount(definition)||!hash(value.identity))fail('MATERIAL_MISSING');return value;
}
async function* originalChunks(materials,original,{signal}={}){
 let offset=0;for(;;){signal?.throwIfAborted();const page=await readDatasetCell(materials,original,{offset,limit:16384,signal});yield page.text;if(page.next===null)return;offset=page.next;}
}
async function* bytes(chunks){let pending='';for await(const chunk of chunks){let text=pending+chunk;pending='';if(/[\uD800-\uDBFF]$/.test(text)){pending=text.slice(-1);text=text.slice(0,-1);}if(text)yield Buffer.from(text);}if(pending)yield Buffer.from(pending);}
const semanticHeader=definition=>revisionText({codec:definition.codec,codecVersion:definition.codecVersion,namespace:definition.namespace,shape:definition.shape});
function componentIdentity(spelling,definition,budget){if(spelling===null)return 'missing';try{const {numerator,denominator}=definition.version===2?validatePolicyScalar({spelling,representation:definition.component.representation,radix:definition.component.radix},definition.resourcePolicy,{budget}):exactRational(spelling,definition.component.representation,definition.component.radix);return numerator+'/'+denominator;}catch(error){if(isScalarResourceFailure(error))throw error;fail();}}
async function componentText(materials,spelling,definition,{signal,budget}={}){if(typeof spelling==='string'||spelling===null)return spelling;if(definition.version!==2||!datasetCellReference(spelling))fail('MATERIAL_MISSING');const {graphScalarCell}=await import('./dataset-resource-values.js'),text=(await graphScalarCell(materials,{value:spelling,kind:'string'},definition.resourcePolicy,{signal})).value;if(createHash('sha256').update(Buffer.from(text,'utf16le')).digest('hex')!==spelling.sha256)fail('MATERIAL_MISSING');componentIdentity(text,definition,budget);return text;}
export async function* parseDomainComponents(materials,original,definition,{signal}={}){
 const shape=definition.shape,stack=[];let scalar=null,seenRoot=false,count=0,intervalParts=[];
 for await(const token of datasetJSONTokens(bytes(originalChunks(materials,original,{signal})),()=>true,{}, {signal,chunked:true})){
  signal?.throwIfAborted();
  if(token.event==='begin'){
   if(token.type!=='array'||token.path.length!==stack.length||stack.length>=shape.length||stack.length===0&&seenRoot)fail();
   if(stack.length&&Number(token.path.at(-1))!==stack.at(-1).count)fail();stack.push({count:0});seenRoot=true;
  }else if(token.event==='end'){
   if(!stack.length||token.path.length!==stack.length-1||stack.at(-1).count!==shape[stack.length-1])fail();stack.pop();if(stack.length)stack.at(-1).count++;
  }else if(token.event==='scalar-start'){
   if(stack.length!==shape.length||token.path.length!==shape.length||Number(token.path.at(-1))!==stack.at(-1).count||!['string','number'].includes(token.kind))fail();scalar='';
  }else if(token.event==='scalar-chunk'){if(scalar===null)fail();scalar+=token.value;if(scalar.length>(definition.resourcePolicy?.resources.maxScalarCharacters??8192))fail(definition.version===2?'DATASET_CALCULATION_RESOURCE':'MEASUREMENT_DOMAIN_COMPONENT_LIMIT');}
  else if(token.event==='value'){
   if(stack.length!==shape.length||token.path.length!==shape.length||Number(token.path.at(-1))!==stack.at(-1).count)fail();
   const spelling=token.kind==='null'?null:['string','number'].includes(token.kind)?scalar:undefined;if(spelling===undefined||spelling===null&&token.kind!=='null')fail();
   componentIdentity(spelling,definition);if(domainCodec(definition)==='interval'){if(spelling===null)fail();intervalParts.push(spelling);}yield {spelling};scalar=null;stack.at(-1).count++;count++;if(stack.at(-1).count>shape[stack.length-1])fail();
  }
 }
 if(!seenRoot||stack.length||count!==domainComponentCount(definition))fail();
 if(domainCodec(definition)==='interval')numericalOperation(definition.version===2?new DatasetResourceBudget(definition.resourcePolicy):undefined,budget=>parseIntervalBounds(intervalParts,definition.component,{budget}));
}
export async function retainDomainValue(materials,cell,definition,save,{signal}={}){
 if(!validDomainDefinition(definition))fail();if(domainValueReference(cell.value))return validateDomainValue(materials,cell.value,definition);
 const retained=await retainDatasetCell(materials,cell,save),original=retained.value,base={format:'domain-value',version:definition.version===2?3:validIntervalDomain(definition)?2:1,definition:structuredClone(definition),original,components:null,identity:null,complete:false};
 if(!knownDomain(definition))return base;
 const digest=createHash('sha256').update(semanticHeader(definition)).update('\n');
 if(domainCodec(definition)==='symbol'){for await(const chunk of originalChunks(materials,original,{signal}))digest.update(Buffer.from(chunk,'utf16le'));return {...base,identity:digest.digest('hex'),complete:true};}
 const components=materials.sequences.builder('domain-components',save);let complete=true;
 for await(const component of parseDomainComponents(materials,original,definition,{signal})){digest.update(componentIdentity(component.spelling,definition)+'\n');complete&&=component.spelling!==null;await components.append(definition.version===2&&typeof component.spelling==='string'&&component.spelling.length>4096?{spelling:(await retainDatasetCell(materials,{kind:'string',value:component.spelling},save)).value}:component);}
 return {...base,components:await components.finish(),identity:digest.digest('hex'),complete};
}
export async function domainValuePage(materials,value,{offset=0,limit=32,signal,resolve=false,budget}={}){
 validateDomainValue(materials,value);if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>64)throw new AppError('INVALID');
 if(!value.components){if(offset!==0)throw new AppError('INVALID');return {definition:value.definition,supported:domainValueSupported(value),items:[],offset:0,total:0,next:null,complete:value.complete};}
 const page=await materials.sequences.page(value.components,{offset,limit}),items=[];for(const [i,item] of page.items.entries()){signal?.throwIfAborted();if(!exact(item,['spelling'])||item.spelling!==null&&typeof item.spelling!=='string'&&!(value.version===3&&datasetCellReference(item.spelling)))fail('MATERIAL_MISSING');const retained=typeof item.spelling!=='string'&&item.spelling!==null,spelling=resolve?await componentText(materials,item.spelling,value.definition,{signal,budget}):item.spelling,canonical=retained&&!resolve?null:componentIdentity(spelling,value.definition,budget);items.push({index:offset+i,position:domainComponentPosition(value.definition,offset+i),spelling,presence:spelling===null?'null':'value',exact:spelling===null?null:canonical});}return {...page,items,definition:value.definition,supported:true,complete:value.complete};
}
export async function readDomainComponent(materials,value,{component,offset=0,limit=4096,signal}={}){validateDomainValue(materials,value);if(!value.components||!Number.isSafeInteger(component)||component<0||component>=value.components?.count)throw new AppError('INVALID');const item=await materials.sequences.item(value.components,component);if(!exact(item,['spelling'])||item.spelling===null)throw new AppError('INVALID');return readDatasetCell(materials,item.spelling,{offset,limit,signal});}
export function domainValueKey(materials,value,definition){validateDomainValue(materials,value,definition);if(!domainValueSupported(value))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');return value.complete?['domain',semanticHeader(definition),value.identity]:null;}
export function domainValuesEqual(materials,a,b){validateDomainValue(materials,a);validateDomainValue(materials,b);if(!domainValueSupported(a)||!domainValueSupported(b))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');if(!sameDomainSpace(a.definition,b.definition))fail('MEASUREMENT_DOMAIN_INCOMPATIBLE');return !a.complete||!b.complete?null:a.identity===b.identity;}
export async function verifyDomainValue(materials,value,{signal}={}){
 validateDomainValue(materials,value);await verifyDatasetCell(materials,{kind:'string',value:value.original},{signal});if(!domainValueSupported(value))return;
 const digest=createHash('sha256').update(semanticHeader(value.definition)).update('\n');let complete=true;
 if(value.components){let index=0;for await(const expected of parseDomainComponents(materials,value.original,value.definition,{signal})){const stored=await materials.sequences.item(value.components,index++);if(!exact(stored,['spelling']))fail('MATERIAL_MISSING');const spelling=await componentText(materials,stored.spelling,value.definition,{signal});if(spelling!==expected.spelling)fail('MATERIAL_MISSING');digest.update(componentIdentity(spelling,value.definition)+'\n');complete&&=spelling!==null;}if(index!==value.components.count)fail('MATERIAL_MISSING');}
 else for await(const chunk of originalChunks(materials,value.original,{signal}))digest.update(Buffer.from(chunk,'utf16le'));
 if(digest.digest('hex')!==value.identity||complete!==value.complete)fail('MATERIAL_MISSING');
}


// Derived algebra uses the same original-text and component sequences as intake.
// The producer yields one exact scalar at a time; its optional budget continues
// through final output validation. Neither a vector nor matrix is materialized.
export async function retainDomainComponents(materials,definition,source,save,{signal}={}){
 if(!validDomainDefinition(definition)||definition.version!==2||!['vector','matrix','complex'].includes(domainCodec(definition)))fail();
 const components=materials.sequences.builder('domain-components',save),digest=createHash('sha256').update(semanticHeader(definition)).update('\n'),expected=domainComponentCount(definition);let count=0,complete=true;
 async function* chunks(){
  yield '[';
  for await(const component of source){
   signal?.throwIfAborted();if(count>=expected||!component||component.spelling!==null&&typeof component.spelling!=='string')fail();
   const spelling=component.spelling,canonical=componentIdentity(spelling,definition,component.budget);digest.update(canonical+'\n');complete&&=spelling!==null;
   const item=typeof spelling==='string'&&spelling.length>4096?{spelling:(await retainDatasetCell(materials,{kind:'string',value:spelling},save)).value}:{spelling};await components.append(item);
   if(definition.shape.length===2){if(count%definition.shape[1]===0)yield (count?',':'')+'[';else yield ',';}
   else if(count)yield ',';
   yield JSON.stringify(spelling);count++;
   if(definition.shape.length===2&&count%definition.shape[1]===0)yield ']';
  }
  if(count!==expected)fail();yield ']';
 }
 const original=(await retainDatasetCell(materials,{kind:'string',read:chunks},save)).value;signal?.throwIfAborted();
 return {format:'domain-value',version:3,definition:structuredClone(definition),original,components:await components.finish(),identity:digest.digest('hex'),complete};
}
