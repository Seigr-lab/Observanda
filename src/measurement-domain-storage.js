// Native domain cells retain their complete original and a paged exact interpretation.
// This adapter uses the existing material sequences and streaming JSON tokenizer.
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
export const domainValueReference=value=>exact(value,['format','version','definition','original','components','identity','complete'])&&value.format==='domain-value'&&value.version===1&&validDomainDefinition(value.definition)&&(typeof value.original==='string'||datasetCellReference(value.original))&&typeof value.complete==='boolean'&&(value.identity===null||hash(value.identity));
export function validateDomainValue(materials,value,definition=value?.definition){
 if(!domainValueReference(value)||revisionText(definition)!==revisionText(value.definition))fail('MATERIAL_MISSING');
 if(!knownDomain(definition)){if(value.components!==null||value.identity!==null||value.complete)fail('MATERIAL_MISSING');return value;}
 if(domainCodec(definition)==='symbol'){if(value.components!==null||!value.complete||!hash(value.identity))fail('MATERIAL_MISSING');return value;}
 materials.sequences.validate(value.components);if(value.components.kind!=='domain-components'||value.components.count!==domainComponentCount(definition)||!hash(value.identity))fail('MATERIAL_MISSING');return value;
}
async function* originalChunks(materials,original,{signal}={}){
 let offset=0;for(;;){signal?.throwIfAborted();const page=await readDatasetCell(materials,original,{offset,limit:16384,signal});yield page.text;if(page.next===null)return;offset=page.next;}
}
async function* bytes(chunks){let pending='';for await(const chunk of chunks){let text=pending+chunk;pending='';if(/[\uD800-\uDBFF]$/.test(text)){pending=text.slice(-1);text=text.slice(0,-1);}if(text)yield Buffer.from(text);}if(pending)yield Buffer.from(pending);}
const semanticHeader=definition=>revisionText({codec:definition.codec,codecVersion:definition.codecVersion,namespace:definition.namespace,shape:definition.shape});
function componentIdentity(spelling,definition){if(spelling===null)return 'missing';try{const {numerator,denominator}=exactRational(spelling,definition.component.representation,definition.component.radix);return numerator+'/'+denominator;}catch{fail();}}
export async function* parseDomainComponents(materials,original,definition,{signal}={}){
 const shape=definition.shape,stack=[];let scalar=null,seenRoot=false,count=0;
 for await(const token of datasetJSONTokens(bytes(originalChunks(materials,original,{signal})),()=>true,{}, {signal,chunked:true})){
  signal?.throwIfAborted();
  if(token.event==='begin'){
   if(token.type!=='array'||token.path.length!==stack.length||stack.length>=shape.length||stack.length===0&&seenRoot)fail();
   if(stack.length&&Number(token.path.at(-1))!==stack.at(-1).count)fail();stack.push({count:0});seenRoot=true;
  }else if(token.event==='end'){
   if(!stack.length||token.path.length!==stack.length-1||stack.at(-1).count!==shape[stack.length-1])fail();stack.pop();if(stack.length)stack.at(-1).count++;
  }else if(token.event==='scalar-start'){
   if(stack.length!==shape.length||token.path.length!==shape.length||Number(token.path.at(-1))!==stack.at(-1).count||!['string','number'].includes(token.kind))fail();scalar='';
  }else if(token.event==='scalar-chunk'){if(scalar===null)fail();scalar+=token.value;if(scalar.length>8192)fail('MEASUREMENT_DOMAIN_COMPONENT_LIMIT');}
  else if(token.event==='value'){
   if(stack.length!==shape.length||token.path.length!==shape.length||Number(token.path.at(-1))!==stack.at(-1).count)fail();
   const spelling=token.kind==='null'?null:['string','number'].includes(token.kind)?scalar:undefined;if(spelling===undefined||spelling===null&&token.kind!=='null')fail();
   componentIdentity(spelling,definition);yield {spelling};scalar=null;stack.at(-1).count++;count++;if(stack.at(-1).count>shape[stack.length-1])fail();
  }
 }
 if(!seenRoot||stack.length||count!==domainComponentCount(definition))fail();
}
export async function retainDomainValue(materials,cell,definition,save,{signal}={}){
 if(!validDomainDefinition(definition))fail();if(domainValueReference(cell.value))return validateDomainValue(materials,cell.value,definition);
 const retained=await retainDatasetCell(materials,cell,save),original=retained.value,base={format:'domain-value',version:1,definition:structuredClone(definition),original,components:null,identity:null,complete:false};
 if(!knownDomain(definition))return base;
 const digest=createHash('sha256').update(semanticHeader(definition)).update('\n');
 if(domainCodec(definition)==='symbol'){for await(const chunk of originalChunks(materials,original,{signal}))digest.update(Buffer.from(chunk,'utf16le'));return {...base,identity:digest.digest('hex'),complete:true};}
 const components=materials.sequences.builder('domain-components',save);let complete=true;
 for await(const component of parseDomainComponents(materials,original,definition,{signal})){digest.update(componentIdentity(component.spelling,definition)+'\n');complete&&=component.spelling!==null;await components.append(component);}
 return {...base,components:await components.finish(),identity:digest.digest('hex'),complete};
}
export async function domainValuePage(materials,value,{offset=0,limit=32,signal}={}){
 validateDomainValue(materials,value);if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>64)throw new AppError('INVALID');
 if(!value.components){if(offset!==0)throw new AppError('INVALID');return {definition:value.definition,supported:knownDomain(value.definition),items:[],offset:0,total:0,next:null,complete:value.complete};}
 const page=await materials.sequences.page(value.components,{offset,limit});signal?.throwIfAborted();const items=page.items.map((item,i)=>{if(!exact(item,['spelling'])||item.spelling!==null&&typeof item.spelling!=='string')fail('MATERIAL_MISSING');const canonical=componentIdentity(item.spelling,value.definition);return {index:offset+i,position:domainComponentPosition(value.definition,offset+i),spelling:item.spelling,presence:item.spelling===null?'null':'value',exact:item.spelling===null?null:canonical};});return {...page,items,definition:value.definition,supported:true,complete:value.complete};
}
export function domainValueKey(materials,value,definition){validateDomainValue(materials,value,definition);if(!knownDomain(definition))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');return value.complete?['domain',semanticHeader(definition),value.identity]:null;}
export function domainValuesEqual(materials,a,b){validateDomainValue(materials,a);validateDomainValue(materials,b);if(!sameDomainSpace(a.definition,b.definition))fail('MEASUREMENT_DOMAIN_INCOMPATIBLE');return !a.complete||!b.complete?null:a.identity===b.identity;}
export async function verifyDomainValue(materials,value,{signal}={}){
 validateDomainValue(materials,value);await verifyDatasetCell(materials,{kind:'string',value:value.original},{signal});if(!knownDomain(value.definition))return;
 const digest=createHash('sha256').update(semanticHeader(value.definition)).update('\n');let complete=true;
 if(value.components){let index=0;for await(const expected of parseDomainComponents(materials,value.original,value.definition,{signal})){const stored=await materials.sequences.item(value.components,index++);if(revisionText(stored)!==revisionText(expected))fail('MATERIAL_MISSING');digest.update(componentIdentity(stored.spelling,value.definition)+'\n');complete&&=stored.spelling!==null;}if(index!==value.components.count)fail('MATERIAL_MISSING');}
 else for await(const chunk of originalChunks(materials,value.original,{signal}))digest.update(Buffer.from(chunk,'utf16le'));
 if(digest.digest('hex')!==value.identity||complete!==value.complete)fail('MATERIAL_MISSING');
}
