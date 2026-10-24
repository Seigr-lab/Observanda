// Closed envelope5 sibling for explicit topology. The caller owns material
// authorization and immutable source identity; catalogue admission guards this format.
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {DatasetResourceError} from './web/dataset-resource-policy.js';
import {withScalarPolicy,scalarTextReference,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {MeasurementTopologyError,validTopologyDefinition,validTopologyKey,validTopologyVertex,validTopologyEdge,topologyCount,TOPOLOGY_PAGE_SIZE} from './web/measurement-topology-model.js';
import {evaluateTopology} from './measurement-topology.js';
import {withScratch} from './scratch-work.js';
import {validIndexRef} from './object-index.js';
import {revisionText} from './web/revision-model.js';
import {datasetJSONTokens} from './dataset-json-tokens.js';
import {DATASET_TEXT_CHARS,retainDatasetCell,readDatasetCell,validateDatasetCell} from './dataset-cell-storage.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const collections=['vertices','edges'];
const missing=()=>{throw new AppError('MATERIAL_MISSING');};
const invalid=()=>{throw new MeasurementTopologyError('MEASUREMENT_TOPOLOGY_INPUT');};
const resource=()=>{throw new DatasetResourceError();};
const sequence=(value,kind)=>exact(value,['format','kind','root','count','chunkSize'])&&value.format===1&&value.kind===kind&&topologyCount(value.count)&&value.chunkSize===16&&!!validIndexRef(value.root)&&(value.root?.count??0)===Math.ceil(value.count/16);
export function topologyValueReference(value){return !!(exact(value,['format','version','definition','original','topology','identity','complete'])&&value.format==='domain-value'&&value.version===5&&validTopologyDefinition(value.definition)&&(typeof value.original==='string'&&value.original.length<=DATASET_TEXT_CHARS||scalarTextReference(value.original))&&exact(value.topology,['version','vertices','edges'])&&value.topology.version===1&&sequence(value.topology.vertices,'topology-vertices')&&sequence(value.topology.edges,'topology-edges')&&hash(value.identity)&&value.complete===true);}
export function validateTopologyValue(materials,value,definition=value?.definition){
 if(!topologyValueReference(value)||revisionText(definition)!==revisionText(value.definition))missing();for(const kind of collections)materials.sequences.validate(value.topology[kind]);validateDatasetCell(materials,{kind:'string',value:value.original});return value;
}
function context(definition,{budget,signal,check,work}={}){
 if(!validTopologyDefinition(definition)||budget!==undefined&&!(budget instanceof DatasetResourceBudget)||work!==undefined&&(!work||!['get','put','add'].every(key=>typeof work[key]==='function')))throw new MeasurementTopologyError();budget??=new DatasetResourceBudget(definition.resourcePolicy);
 const run=operation=>{signal?.throwIfAborted();try{return numericalOperation(budget,operation);}catch(error){if(error instanceof AppError||error instanceof MeasurementTopologyError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;invalid();}},current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();},io=async operation=>{run(b=>b.step());await current();const value=await operation();await current();return value;};return {definition,budget,signal,check,work,run,current,io};
}
function chargeText(text,c){c.run(b=>{for(let i=0;i<text.length;i++)b.step();});}
function checkItem(collection,item,c){
 c.run(b=>{b.step();if(!(collection==='vertices'?validTopologyVertex(item):validTopologyEdge(item)))invalid();withScalarPolicy(c.definition.resourcePolicy,b,own=>{for(const key of collection==='vertices'?['key']:['key','from','to']){if(item[key].length>own.scalarPolicy.resources.maxScalarCharacters)resource();for(let i=0;i<item[key].length;i++)own.step();}});});return item;
}
function digests(definition){const values={vertices:createHash('sha256'),edges:createHash('sha256')},counts={vertices:0,edges:0};return {
 add(collection,item,c){c.run(b=>{b.step();if(!Number.isSafeInteger(counts[collection]+1))resource();values[collection].update(revisionText(item)+'\n');counts[collection]++;});},
 finish(c){return c.run(b=>{b.step();const semantics={codec:definition.codec,codecVersion:definition.codecVersion,namespace:definition.namespace,direction:definition.direction,loops:definition.loops,parallelEdges:definition.parallelEdges},digest=createHash('sha256').update(revisionText(semantics)+'\n');for(const collection of collections)digest.update(collection+':'+values[collection].update('count:'+counts[collection]+'\n').digest('hex')+'\n');return digest.digest('hex');});},counts
 };}
async function* originalChunks(materials,original,c){
 let offset=0;const total=typeof original==='string'?original.length:original.characters,digest=createHash('sha256');for(;;){const page=await c.io(()=>readDatasetCell(materials,original,{offset,limit:DATASET_TEXT_CHARS,signal:c.signal})),length=Math.min(DATASET_TEXT_CHARS,total-offset);if(page.offset!==offset||page.total!==total||typeof page.text!=='string'||page.text.length!==length||page.next!==(offset+length<total?offset+length:null))missing();c.run(b=>{b.step();digest.update(Buffer.from(page.text,'utf16le'));});yield page.text;if(page.next===null)break;offset=page.next;}if(typeof original!=='string'&&digest.digest('hex')!==original.sha256)missing();
}
// Keep literal surrogate pairs across text pages. Escaped JSON is decoded by
// the tokenizer and checked by validTopologyKey, which also rejects unpaired
// code units. Valid Unicode is never normalized, folded or trimmed.
async function* utf8(chunks,c){let pending='';for await(const chunk of chunks){let text=pending+chunk;pending='';if(/[\uD800-\uDBFF]$/.test(text)){pending=text.slice(-1);text=text.slice(0,-1);}c.run(b=>{for(let i=0;i<text.length;i++){b.step();const code=text.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))invalid();}else if(code>=0xdc00&&code<=0xdfff)invalid();}});if(text)yield Buffer.from(text);}if(pending)invalid();}
async function* parsedItems(materials,original,c){
 let started=false,ended=false,collection=null,item=null,field=null,scalar=null,inputFailure=null;const seen={vertices:false,edges:false},counts={vertices:0,edges:0};
 async function* input(){try{yield* utf8(originalChunks(materials,original,c),c);}catch(error){inputFailure=error;throw error;}}
 try{for await(const token of datasetJSONTokens(input(),()=>true,{keys:3,rowChars:2048},{signal:c.signal,chunked:true})){
  c.run(b=>b.step());await c.current();const path=token.path;
  if(token.event==='begin'){
   if(path.length===0){if(started||ended||token.type!=='object')invalid();started=true;continue;}
   if(!started||ended)invalid();
   if(path.length===1){if(collection!==null||item!==null||token.type!=='array'||!collections.includes(path[0])||seen[path[0]])invalid();collection=path[0];seen[collection]=true;continue;}
   if(path.length===2){if(collection===null||path[0]!==collection||path[1]!==String(counts[collection])||item!==null||token.type!=='object')invalid();item={};continue;}
   invalid();
  }
  if(token.event==='end'){
   if(path.length===0){if(!started||ended||collection!==null||item!==null||!seen.vertices||!seen.edges)invalid();ended=true;continue;}
   if(path.length===1){if(collection!==path[0]||item!==null||scalar!==null)invalid();collection=null;continue;}
   if(path.length===2){if(!item||path[0]!==collection||path[1]!==String(counts[collection])||scalar!==null)invalid();checkItem(collection,item,c);yield {collection,index:counts[collection],item};if(!Number.isSafeInteger(counts[collection]+1))resource();counts[collection]++;item=null;continue;}
   invalid();
  }
  if(!item||collection===null||path.length!==3||path[0]!==collection||path[1]!==String(counts[collection])||!(collection==='vertices'?['key']:['key','from','to']).includes(path[2]))invalid();
  if(token.event==='scalar-start'){if(scalar!==null||token.kind!=='string'||Object.hasOwn(item,path[2]))invalid();field=path[2];scalar='';}
  else if(token.event==='scalar-chunk'){if(scalar===null||field!==path[2])invalid();c.run(b=>{b.step();scalar+=token.value;if(scalar.length>200)invalid();if(scalar.length>Math.min(c.definition.resourcePolicy.resources.maxScalarCharacters,c.budget.scalarPolicy.resources.maxScalarCharacters))resource();});}
  else if(token.event==='value'){if(token.kind!=='string'||scalar===null||field!==path[2])invalid();item[field]=scalar;scalar=null;field=null;}
  else invalid();
 }}catch(error){if(inputFailure)throw inputFailure;if(error?.code==='MATERIAL_TABLE')invalid();throw error;}
 if(inputFailure)throw inputFailure;if(!started||!ended||collection!==null||item!==null||scalar!==null)invalid();
}
async function readPage(materials,value,collection,offset,limit,c){
 const descriptor=value.topology[collection],page=await c.io(()=>materials.sequences.page(descriptor,{offset,limit})),length=Math.min(limit,descriptor.count-offset);if(!page||page.offset!==offset||page.total!==descriptor.count||!Array.isArray(page.items)||page.items.length!==length||page.next!==(offset+length<descriptor.count?offset+length:null))missing();for(const item of page.items)checkItem(collection,item,c);return page;
}
function sourceFor(materials,value,c){return {definition:value.definition,vertexCount:value.topology.vertices.count,edgeCount:value.topology.edges.count,readVertices:request=>readPage(materials,value,'vertices',request.offset,request.limit,c),readEdges:request=>readPage(materials,value,'edges',request.offset,request.limit,c)};}
async function validateRules(materials,value,c){const evaluate=work=>evaluateTopology({kind:'counts'},sourceFor(materials,value,c),{resourcePolicy:c.budget.scalarPolicy,budget:c.budget,work,signal:c.signal,check:c.check});return c.work?evaluate(c.work):withScratch(evaluate,{signal:c.signal});}
export async function retainTopologyValue(materials,cell,definition,save,options={}){
 const c=context(definition,options);if(typeof save!=='function')throw new MeasurementTopologyError();if(cell?.value?.format==='domain-value'){validateTopologyValue(materials,cell.value,definition);return verifyTopologyValue(materials,cell.value,options);}const write=operation=>c.io(()=>save(operation));
 let authored=cell;if(typeof cell?.read==='function'||typeof cell?.value==='string'){const input=cell.read?()=>cell.read():()=>[cell.value];authored={...cell,kind:'string',read:async function*(){for await(const chunk of input()){await c.current();if(typeof chunk!=='string')invalid();for(let offset=0;offset<chunk.length;offset+=DATASET_TEXT_CHARS){await c.current();const text=chunk.slice(offset,offset+DATASET_TEXT_CHARS);chargeText(text,c);yield text;}}}};}if(!authored)invalid();
 const original=(await c.io(()=>retainDatasetCell(materials,authored,write))).value,builders=Object.fromEntries(collections.map(kind=>[kind,materials.sequences.builder('topology-'+kind,write)])),digest=digests(definition);
 for await(const entry of parsedItems(materials,original,c)){digest.add(entry.collection,entry.item,c);await c.io(()=>builders[entry.collection].append(entry.item));}
 const topology={version:1};for(const kind of collections)topology[kind]=await c.io(()=>builders[kind].finish());const value={format:'domain-value',version:5,definition:structuredClone(definition),original,topology,identity:digest.finish(c),complete:true};validateTopologyValue(materials,value);await validateRules(materials,value,c);await c.current();return value;
}
export async function topologyValuePage(materials,value,{collection='vertices',offset=0,limit=TOPOLOGY_PAGE_SIZE,...options}={}){
 validateTopologyValue(materials,value);if(!collections.includes(collection)||!topologyCount(offset)||offset>value.topology[collection].count||!Number.isSafeInteger(limit)||limit<1||limit>TOPOLOGY_PAGE_SIZE)throw new AppError('INVALID');const c=context(value.definition,options),page=await readPage(materials,value,collection,offset,limit,c);await c.current();return {...page,items:page.items.map((item,index)=>({...item,index:offset+index})),collection,definition:value.definition,supported:true,complete:true};
}
export async function readTopologyItem(materials,value,{collection='vertices',index,...options}={}){if(!topologyCount(index))throw new AppError('INVALID');const page=await topologyValuePage(materials,value,{collection,offset:index,limit:1,...options});if(!page.items.length)throw new AppError('INVALID');return {...page.items[0],collection};}
export async function findTopologyKey(materials,value,{collection='vertices',key,...options}={}){
 validateTopologyValue(materials,value);if(!collections.includes(collection)||!validTopologyKey(key))throw new AppError('INVALID');const c=context(value.definition,options),count=value.topology[collection].count;for(let offset=0;offset<count;offset+=TOPOLOGY_PAGE_SIZE){const page=await readPage(materials,value,collection,offset,TOPOLOGY_PAGE_SIZE,c);for(let i=0;i<page.items.length;i++)if(page.items[i].key===key){await c.current();return {...page.items[i],index:offset+i,collection};}}throw new MeasurementTopologyError('MEASUREMENT_TOPOLOGY_KEY');
}
export async function verifyTopologyValue(materials,value,options={}){
 validateTopologyValue(materials,value);const c=context(value.definition,options),digest=digests(value.definition),cached={vertices:null,edges:null};try{
 for await(const entry of parsedItems(materials,value.original,c)){const descriptor=value.topology[entry.collection];if(entry.index>=descriptor.count)missing();let page=cached[entry.collection];if(!page||entry.index>=page.offset+page.items.length)page=cached[entry.collection]=await readPage(materials,value,entry.collection,entry.index,TOPOLOGY_PAGE_SIZE,c);const item=page.items[entry.index-page.offset];if(revisionText(item)!==revisionText(entry.item))missing();digest.add(entry.collection,item,c);}
 for(const collection of collections)if(digest.counts[collection]!==value.topology[collection].count)missing();if(digest.finish(c)!==value.identity)missing();await validateRules(materials,value,c);await c.current();return value;
 }catch(error){if(error instanceof MeasurementTopologyError)missing();throw error;}
}
