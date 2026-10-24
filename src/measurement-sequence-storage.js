// Sequence values use the same authenticated component/text sequences as other
// native domains. Shared codec admission delegates current sequence values here.
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {DatasetResourceError} from './web/dataset-resource-policy.js';
import {validatePolicyScalar,withScalarPolicy,scalarTextReference,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {MeasurementSequenceError,validSequenceDefinition,sequenceCount} from './web/measurement-sequence-model.js';
import {revisionText} from './web/revision-model.js';
import {datasetJSONTokens} from './dataset-json-tokens.js';
import {DATASET_INLINE_CHARS,DATASET_TEXT_CHARS,retainDatasetCell,readDatasetCell,validateDatasetCell} from './dataset-cell-storage.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const missing=()=>{throw new AppError('MATERIAL_MISSING');};
const invalid=()=>{throw new MeasurementSequenceError('MEASUREMENT_SEQUENCE_INPUT');};
const resource=()=>{throw new DatasetResourceError();};
const envelopeKeys=['format','version','definition','original','components','identity','complete','count'];
export function sequenceValueReference(value){return !!(exact(value,envelopeKeys)&&value.format==='domain-value'&&value.version===5&&validSequenceDefinition(value.definition)&&sequenceCount(value.count)&&(typeof value.original==='string'&&value.original.length<=DATASET_TEXT_CHARS||scalarTextReference(value.original))&&exact(value.components,['format','kind','root','count','chunkSize'])&&value.components.format===1&&value.components.kind==='domain-components'&&value.components.count===value.count&&value.components.chunkSize===16&&hash(value.identity)&&typeof value.complete==='boolean'&&(value.count!==0||value.complete));}
export function validateSequenceValue(materials,value,definition=value?.definition){
 if(!sequenceValueReference(value)||revisionText(definition)!==revisionText(value.definition))missing();materials.sequences.validate(value.components);if(value.components.kind!=='domain-components'||value.components.count!==value.count)missing();validateDatasetCell(materials,{kind:'string',value:value.original});return value;
}
function context(definition,{budget,signal,check}={}){
 if(!validSequenceDefinition(definition)||budget!==undefined&&!(budget instanceof DatasetResourceBudget))throw new MeasurementSequenceError();budget??=new DatasetResourceBudget(definition.resourcePolicy);
 const run=operation=>{signal?.throwIfAborted();try{return numericalOperation(budget,operation);}catch(error){if(error instanceof AppError||error instanceof MeasurementSequenceError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;invalid();}},current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();},io=async operation=>{await current();const result=await operation();await current();return result;};return {definition,budget,signal,run,current,io};
}
function canonical(spelling,c){return c.run(b=>{
 b.step();if(spelling===null)return {kind:'null'};if(typeof spelling!=='string')invalid();
 if(c.definition.element.kind==='numeric'){const element=c.definition.element,value=validatePolicyScalar({spelling,representation:element.representation,radix:element.radix},c.definition.resourcePolicy,{budget:b});return {kind:'numeric',value:value.numerator+'/'+value.denominator};}
 withScalarPolicy(c.definition.resourcePolicy,b,own=>{if(spelling.length>own.scalarPolicy.resources.maxScalarCharacters)resource();for(let i=0;i<spelling.length;i++)own.step();});return {kind:'symbol',value:spelling};
 });}
function digestFor(definition){return createHash('sha256').update(revisionText({codec:definition.codec,codecVersion:definition.codecVersion,namespace:definition.namespace,element:definition.element})+'\n');}
const digestItem=(digest,item,c)=>c.run(b=>{b.step();digest.update(revisionText(item)+'\n');});
const finishDigest=(digest,count,c)=>c.run(b=>{b.step();return digest.update('count:'+count+'\n').digest('hex');});
const boundText=(text,c)=>{if(typeof text!=='string')invalid();if(text.length>Math.min(c.definition.resourcePolicy.resources.maxScalarCharacters,c.budget.scalarPolicy.resources.maxScalarCharacters))resource();};
async function componentText(materials,spelling,c){
 if(typeof spelling==='string'||spelling===null){if(spelling!==null)boundText(spelling,c);return spelling;}
 if(!scalarTextReference(spelling))missing();if(spelling.characters>Math.min(c.definition.resourcePolicy.resources.maxScalarCharacters,c.budget.scalarPolicy.resources.maxScalarCharacters))resource();let text='',offset=0;const digest=createHash('sha256');
 do{const page=await c.io(()=>readDatasetCell(materials,spelling,{offset,limit:4096,signal:c.signal}));if(page.offset!==offset||page.total!==spelling.characters||page.next!==null&&page.next<=offset)missing();c.run(b=>{b.step();text+=page.text;digest.update(Buffer.from(page.text,'utf16le'));boundText(text,c);});offset=page.next;}while(offset!==null);
 if(text.length!==spelling.characters||digest.digest('hex')!==spelling.sha256)missing();return text;
}
async function* originalChunks(materials,original,c){
 let offset=0;const digest=createHash('sha256');for(;;){const page=await c.io(()=>readDatasetCell(materials,original,{offset,limit:DATASET_TEXT_CHARS,signal:c.signal}));if(page.offset!==offset||page.next!==null&&page.next<=offset)missing();c.run(b=>{b.step();digest.update(Buffer.from(page.text,'utf16le'));});yield page.text;if(page.next===null)break;offset=page.next;}
 if(typeof original!=='string'&&digest.digest('hex')!==original.sha256)missing();
}
// Carry a split surrogate pair; refuse invalid literal Unicode rather than
// silently changing it through Buffer's replacement-character conversion.
async function* utf8(chunks,c){let pending='';for await(const chunk of chunks){let text=pending+chunk;pending='';if(/[\uD800-\uDBFF]$/.test(text)){pending=text.slice(-1);text=text.slice(0,-1);}c.run(b=>{for(let i=0;i<text.length;i++){b.step();const code=text.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))invalid();}else if(code>=0xdc00&&code<=0xdfff)invalid();}});if(text)yield Buffer.from(text);}if(pending)invalid();}
async function* parsedElements(materials,original,c){
 let started=false,ended=false,scalar=null,count=0,inputFailure=null;
 async function* input(){try{yield* utf8(originalChunks(materials,original,c),c);}catch(error){inputFailure=error;throw error;}}
 try{for await(const token of datasetJSONTokens(input(),()=>true,{}, {signal:c.signal,chunked:true})){
  c.signal?.throwIfAborted();c.run(b=>b.step());
  if(token.event==='begin'){if(started||token.type!=='array'||token.path.length!==0)invalid();started=true;continue;}
  if(token.event==='end'){if(!started||ended||token.path.length!==0||scalar!==null)invalid();ended=true;continue;}
  if(!started||ended||token.path.length!==1||token.path[0]!==String(count))invalid();
  if(token.event==='scalar-start'){if(scalar!==null||!['string','number'].includes(token.kind)||c.definition.element.kind==='symbol'&&token.kind!=='string')invalid();scalar='';}
  else if(token.event==='scalar-chunk'){if(scalar===null)invalid();c.run(b=>{b.step();scalar+=token.value;boundText(scalar,c);});}
  else if(token.event==='value'){const spelling=token.kind==='null'?null:['string','number'].includes(token.kind)?scalar:undefined;if(spelling===undefined||spelling===null&&token.kind!=='null')invalid();const identity=canonical(spelling,c);if(!Number.isSafeInteger(count+1))invalid();yield {spelling,identity};count++;scalar=null;}
  else invalid();
 }}catch(error){throw inputFailure??error;}
 if(inputFailure)throw inputFailure;if(!started||!ended||scalar!==null)invalid();
}
async function storedComponent(materials,spelling,save,c){return {spelling:typeof spelling==='string'&&spelling.length>DATASET_INLINE_CHARS?(await c.io(()=>retainDatasetCell(materials,{kind:'string',value:spelling},save))).value:spelling};}
function valueResult(definition,original,components,identity,complete,count){return {format:'domain-value',version:5,definition:structuredClone(definition),original,components,identity,complete,count};}
export async function retainSequenceValue(materials,cell,definition,save,options={}){
 const c=context(definition,options);if(typeof save!=='function')throw new MeasurementSequenceError();if(!cell||typeof cell!=='object'||Array.isArray(cell)||['null','absent'].includes(cell.kind))invalid();await c.current();if(cell?.value?.format==='domain-value')return validateSequenceValue(materials,cell.value,definition);const write=operation=>c.io(()=>save(operation));
 let authored=cell;if(typeof cell?.read==='function'||typeof cell?.value==='string'){const input=cell.read?()=>cell.read():()=>[cell.value];authored={...cell,read:async function*(){for await(const chunk of input()){await c.current();if(typeof chunk!=='string')invalid();for(let offset=0;offset<chunk.length;offset+=DATASET_TEXT_CHARS){await c.current();yield chunk.slice(offset,offset+DATASET_TEXT_CHARS);}}}};}
 const original=(await c.io(()=>retainDatasetCell(materials,authored,write))).value,components=materials.sequences.builder('domain-components',write),digest=digestFor(definition);let count=0,complete=true;
 for await(const item of parsedElements(materials,original,c)){digestItem(digest,item.identity,c);complete&&=item.spelling!==null;await components.append(await storedComponent(materials,item.spelling,write,c));count++;}
 const index=await components.finish();await c.current();return valueResult(definition,original,index,finishDigest(digest,count,c),complete,count);
}
export async function retainSequenceElements(materials,definition,source,save,options={}){
 const c=context(definition,options);if(typeof save!=='function'||!source||typeof source[Symbol.asyncIterator]!=='function'&&typeof source[Symbol.iterator]!=='function')throw new MeasurementSequenceError();const write=operation=>c.io(()=>save(operation)),components=materials.sequences.builder('domain-components',write),digest=digestFor(definition);let count=0,complete=true;
 async function* chunks(){yield '[';for await(const item of source){await c.current();if(!exact(item,['spelling']))invalid();const identity=canonical(item.spelling,c);if(!Number.isSafeInteger(count+1))invalid();digestItem(digest,identity,c);complete&&=item.spelling!==null;await components.append(await storedComponent(materials,item.spelling,write,c));if(count)yield ',';yield JSON.stringify(item.spelling);count++;}yield ']';}
 const original=(await c.io(()=>retainDatasetCell(materials,{kind:'string',read:chunks},write))).value,index=await components.finish();await c.current();return valueResult(definition,original,index,finishDigest(digest,count,c),complete,count);
}
export async function sequenceValuePage(materials,value,{offset=0,limit=32,resolve=false,...options}={}){
 validateSequenceValue(materials,value);if(!sequenceCount(offset)||offset>value.count||!Number.isInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');const c=context(value.definition,options),page=await c.io(()=>materials.sequences.page(value.components,{offset,limit})),items=[];
 if(page.offset!==offset||page.total!==value.count||page.items.length!==Math.min(limit,value.count-offset)||page.next!==(offset+page.items.length<value.count?offset+page.items.length:null))missing();
 for(const [i,item]of page.items.entries()){await c.current();if(!exact(item,['spelling'])||item.spelling!==null&&typeof item.spelling!=='string'&&!scalarTextReference(item.spelling))missing();let spelling=item.spelling,identity=null;if(typeof spelling==='string')boundText(spelling,c);else if(spelling!==null&&spelling.characters>value.definition.resourcePolicy.resources.maxScalarCharacters)resource();if(resolve)spelling=await componentText(materials,spelling,c);if(resolve||spelling===null||typeof spelling==='string')identity=canonical(spelling,c);items.push({index:offset+i,position:[offset+i],spelling,presence:spelling===null?'null':'value',exact:identity?.kind==='numeric'?identity.value:null});}
 return {...page,items,definition:value.definition,supported:true,complete:value.complete};
}
export async function readSequenceElement(materials,value,{index,offset=0,limit=4096,...options}={}){
 validateSequenceValue(materials,value);if(!sequenceCount(index)||index>=value.count)throw new AppError('INVALID');const c=context(value.definition,options),item=await c.io(()=>materials.sequences.item(value.components,index));if(!exact(item,['spelling'])||item.spelling===null)throw new AppError('INVALID');if(typeof item.spelling!=='string'&&!scalarTextReference(item.spelling))missing();if(typeof item.spelling==='string')boundText(item.spelling,c);else if(item.spelling.characters>Math.min(value.definition.resourcePolicy.resources.maxScalarCharacters,c.budget.scalarPolicy.resources.maxScalarCharacters))resource();return c.io(()=>readDatasetCell(materials,item.spelling,{offset,limit,signal:c.signal}));
}
export async function verifySequenceValue(materials,value,options={}){
 validateSequenceValue(materials,value);const c=context(value.definition,options),digest=digestFor(value.definition);let count=0,complete=true,cached=null;
 for await(const expected of parsedElements(materials,value.original,c)){
  if(count>=value.count)missing();if(!cached||count>=cached.offset+cached.items.length){cached=await c.io(()=>materials.sequences.page(value.components,{offset:count,limit:16}));if(cached.offset!==count||cached.total!==value.count||cached.items.length!==Math.min(16,value.count-count))missing();}
  const item=cached.items[count-cached.offset];if(!exact(item,['spelling']))missing();const spelling=await componentText(materials,item.spelling,c);if(spelling!==expected.spelling)missing();digestItem(digest,expected.identity,c);complete&&=spelling!==null;count++;
 }
 if(count!==value.count||complete!==value.complete||finishDigest(digest,count,c)!==value.identity)missing();await c.current();return value;
}
