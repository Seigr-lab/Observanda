import {hasPlotResourceFigure,hasPlotResourceFigures,plotResourceFigureDocument} from './plot-resource-format.js';
import {requireFigureProjectionPolicies,catalogueRequiresFigureProjectionPolicies} from './catalogue-format.js';
import {hasAuthoredFigures,authoredFigureDocument} from './figure-authoring-format.js';
import {requireFigureAuthoring,catalogueRequiresFigureAuthoring} from './catalogue-format.js';
import {hasRetainedFigures,retainedFigureDocument} from './record-retained-figures.js';
import {requireRetainedFigures,catalogueRequiresRetainedFigures} from './catalogue-format.js';
import {hasRecordProjection,projectedFigureDocument} from './record-numerical-models.js';
import {requireNativeNumericalModels,catalogueRequiresNativeNumericalModels} from './catalogue-format.js';
import {retiredProjectRecord,withRetiredProjectRecord} from './project-retired-records.js';
// One owner for legacy originals and immutable record-block manifests. Public
// record IDs, storage digests and logical revision identities do not change.
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {seal,unseal} from './encryption.js';
import {digest,serialize} from './storage-format.js';
import {RecordBlockStore,blockedRecord,validBlockedRecord,recordBlockResource} from './record-block-store.js';
import {catalogueFormat,catalogueRequiresNestedAttemptCollections,requireNestedAttemptCollections,catalogueRequiresSourcePublicationControls,requireSourcePublicationControls,requireRecordBlocks,requireAttemptIndexes,requireCurrentAttemptIndexes,requireRecordMethodIndexes,requireRecordResultIndexes,catalogueRequiresPagedResearchTables,requirePagedResearchTables} from './catalogue-format.js';
import {jsonFitsBytes} from './web/json-chunks.js';
import {recordEncoding} from './record-encoding.js';
import {retainRecordOwnerResource} from './record-owner-resources.js';
import {RecordDocument,withRecordDocument} from './record-document.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
import {RecordMethodIndex} from './record-method-index.js';
import {RecordResultIndex} from './record-result-index.js';
import {pagedTableDocument} from './retained-tables.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const requireIndexFormat=(db,index)=>index.version>=3?requireNestedAttemptCollections(db):index.version>=2?requireCurrentAttemptIndexes(db):requireAttemptIndexes(db);
function recordResources(value,generation){
 if(!blockedRecord(value))return [];
 const ref=(kind,revision)=>recordBlockResource(value.notebookId,generation,kind,revision),dependencies=[ref('value',value.root)];
 for(const key of ['attemptIndex','methodIndex','resultIndex'])if(value[key]){dependencies.push(ref('value',value[key].source));if(value[key].root)dependencies.push(ref('index',value[key].root.hash));}
 return dependencies;
}
export async function withRecordEnvelope(store,id,revision,consume){
 const row=await store.db.get('SELECT scope_id,generation,payload FROM records WHERE id=$1 AND revision=$2',id,revision);if(!row)fail();
 const key=await store.scopeKey(row.scope_id,row.generation);
 try{
  let value;try{value=JSON.parse(unseal(Buffer.from(row.payload),key,store.recordAAD(id,revision,row.scope_id,row.generation)).toString('utf8'));}catch(error){if(error instanceof AppError)throw error;fail();}
  if(!value||value.id!==id||value.notebookId!==row.scope_id)fail();
  return await consume({row,key,value});
 }finally{key.fill(0);}
}
export async function withStoredRecord(store,id,revision,consume){
 return withRecordEnvelope(store,id,revision,async({row,key,value})=>{
  if(retiredProjectRecord(value)){if(await catalogueFormat(store.db)<23)fail();return withRetiredProjectRecord(store,value,id,revision,row.scope_id,consume);}
  let blocks=null;
  if(blockedRecord(value)){
   if(!validBlockedRecord(value)||await catalogueFormat(store.db)<(value.version===4?26:value.version===3?14:value.attemptIndex?.version===2?12:value.version===2?11:4))fail();blocks=new RecordBlockStore(store,row.scope_id,row.generation,key);
   for(const [name,expected] of [['id',id],['notebookId',row.scope_id]]){const selected=await blocks.tree().selected(value.root,[name]);if(!selected.found||selected.value!==expected)fail();}
   if(value.attemptIndex?.version===3&&!catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db)))fail();
   if(value.attemptIndex){const document=new RecordDocument(blocks,value.root);if(value.attemptIndex.source!==await document.reference(['attempt']))fail();}
   if(value.methodIndex){const document=new RecordDocument(blocks,value.root);if(value.methodIndex.source!==await document.reference(['relations']))fail();}
   if(value.resultIndex&&!await RecordResultIndex.open(new RecordDocument(blocks,value.root,{resultIndex:value.resultIndex})))fail();
  }else if(digest(serialize(value))!==revision)fail();
  return await consume({store,row,key,value,blocks});
 });
}
export async function retainStoredRecord(store,record,revision){
 if(hasRecordProjection(record))await requireNativeNumericalModels(store.db);
 if(hasPlotResourceFigures(record))await requireFigureProjectionPolicies(store.db);
 if(hasAuthoredFigures(record))await requireFigureAuthoring(store.db);
 if(hasRetainedFigures(record))await requireRetainedFigures(store.db);
 if(record.results?.statements.some(statement=>statement.table?.version===3))await requirePagedResearchTables(store.db);
 if(record.sections?.some(section=>Object.hasOwn(section,'share')))await requireSourcePublicationControls(store.db);
 const scopeId=record.notebookId,generation=1,key=await store.scopeKey(scopeId,generation,{create:true});
 try{
  let retained,dependencies=[];
  // Indexed owners and larger originals share immutable blocks. The byte
  // threshold chooses representation; it does not limit record content.
  if(record.attempt||record.results||record.relations?.some(link=>link.role==='uses-method')||!jsonFitsBytes(record,65535,{pretty:true})){
   await requireRecordBlocks(store.db);if(record.attempt)await requireNestedAttemptCollections(store.db);
   const blocks=new RecordBlockStore(store,scopeId,generation,key),value=await blocks.retain(record),document=new RecordDocument(blocks,value.root),attemptIndex=await RecordAttemptIndex.retain(document);
   if(attemptIndex){await requireIndexFormat(store.db,attemptIndex);value.version=2;value.attemptIndex=attemptIndex;}
   const methodIndex=await RecordMethodIndex.retain(document);if(methodIndex){await requireRecordMethodIndexes(store.db);value.version=3;value.methodIndex=methodIndex;}
   const resultIndex=await RecordResultIndex.retain(document);if(resultIndex){await requireRecordResultIndexes(store.db);value.version=4;value.resultIndex=resultIndex;}await blocks.flush();
   retained=serialize(value);dependencies=recordResources(value,generation);
  }else retained=serialize(record);
  await retainRecordOwnerResource(store,{kind:'record',id:record.id,revision},{present:false,dependencies});
  await store.db.run('INSERT INTO records VALUES ($1,$2,$3,$4,$5)',record.id,revision,scopeId,generation,seal(Buffer.from(retained),key,store.recordAAD(record.id,revision,scopeId,generation)));
 }finally{key.fill(0);}
}
export async function readStoredRecord(store,id,revision){
 return withStoredRecord(store,id,revision,async({value,blocks})=>{
  if(!blocks)return value;
  const record=await blocks.tree().read(value.root);
  if(record.id!==id||record.notebookId!==value.notebookId||recordEncoding(record).revision!==revision)fail();return record;
 });
}
export async function retainStoredDocument(store,document,encoding){
 const id=(await document.field(['id'])).value,scopeId=(await document.field(['notebookId'])).value,{blocks}=document;
 if(blocks.store!==store||scopeId!==blocks.scopeId)throw new AppError('INVALID');
 const revision=encoding.revision;
 if(!catalogueRequiresNativeNumericalModels(await catalogueFormat(store.db))&&await projectedFigureDocument(document))await requireNativeNumericalModels(store.db);
 if(!catalogueRequiresFigureProjectionPolicies(await catalogueFormat(store.db))&&await plotResourceFigureDocument(document))await requireFigureProjectionPolicies(store.db);
 if(!catalogueRequiresFigureAuthoring(await catalogueFormat(store.db))&&await authoredFigureDocument(document))await requireFigureAuthoring(store.db);
 if(!catalogueRequiresRetainedFigures(await catalogueFormat(store.db))&&await retainedFigureDocument(document))await requireRetainedFigures(store.db);
 const present=!!await store.db.get('SELECT 1 FROM records WHERE id=$1 AND revision=$2',id,revision);
 if(present){await retainRecordOwnerResource(store,{kind:'record',id,revision},{present:true});return false;}
 // Only inspect permission fields until this owner requires the new reader.
 // Large section bodies remain referenced; subsequent saves skip this pass.
 if(!catalogueRequiresSourcePublicationControls(await catalogueFormat(store.db)))for await(const section of document.items(['sections'])){
  if((await document.tree.selected(section.value,['share'])).found){await requireSourcePublicationControls(store.db);break;}
 }
 if(!catalogueRequiresPagedResearchTables(await catalogueFormat(store.db))&&await pagedTableDocument(document))await requirePagedResearchTables(store.db);
 await requireRecordBlocks(store.db);if(await document.reference(['attempt'])&&document.attemptIndex?.source!==await document.reference(['attempt']))await requireNestedAttemptCollections(store.db);const attemptIndex=await RecordAttemptIndex.retain(document);if(attemptIndex)await requireIndexFormat(store.db,attemptIndex);
 const methodIndex=await RecordMethodIndex.retain(document);if(methodIndex)await requireRecordMethodIndexes(store.db);
 const resultIndex=await RecordResultIndex.retain(document);if(resultIndex)await requireRecordResultIndexes(store.db);await blocks.flush();
 const value={format:'observanda-record-blocks',version:resultIndex?4:methodIndex?3:attemptIndex?2:1,id,notebookId:scopeId,root:document.root,...(attemptIndex?{attemptIndex}:{}),...(methodIndex?{methodIndex}:{}),...(resultIndex?{resultIndex}:{})};
 await retainRecordOwnerResource(store,{kind:'record',id,revision},{present:false,dependencies:recordResources(value,blocks.generation)});
 await store.db.run('INSERT INTO records VALUES ($1,$2,$3,$4,$5)',id,revision,scopeId,blocks.generation,
  seal(Buffer.from(serialize(value)),blocks.key,store.recordAAD(id,revision,scopeId,blocks.generation)));
 return true;
}
export async function verifyStoredRecord(store,id,revision,{signal}={}){
 signal?.throwIfAborted();
 const indexed=await withStoredRecord(store,id,revision,async({value,blocks})=>{
  if(blocks){const hash=createHash('sha256');for await(const text of blocks.tree().json(value.root,{signal}))hash.update(text);hash.update('\n');if(hash.digest('hex')!==revision)fail();}
  if(!catalogueRequiresNativeNumericalModels(await catalogueFormat(store.db))&&(blocks?await projectedFigureDocument(new RecordDocument(blocks,value.root),{signal}):hasRecordProjection(value)))fail();
  if(!catalogueRequiresFigureProjectionPolicies(await catalogueFormat(store.db))&&(blocks?await plotResourceFigureDocument(new RecordDocument(blocks,value.root),{signal}):hasPlotResourceFigures(value)))fail();
 if(!catalogueRequiresFigureAuthoring(await catalogueFormat(store.db))&&(blocks?await authoredFigureDocument(new RecordDocument(blocks,value.root),{signal}):hasAuthoredFigures(value)))fail();
 if(!catalogueRequiresRetainedFigures(await catalogueFormat(store.db))&&(blocks?await retainedFigureDocument(new RecordDocument(blocks,value.root),{signal}):hasRetainedFigures(value)))fail();
  return {attempt:!!value.attemptIndex,methods:!!value.methodIndex,results:!!value.resultIndex};
 });
 if(indexed.attempt||indexed.methods||indexed.results)await withRecordDocument(store,id,revision,async document=>{
  if(indexed.attempt)await (await RecordAttemptIndex.open(document,{signal})).verify({signal});
  if(indexed.methods)await (await RecordMethodIndex.open(document,{signal})).verify({signal});
  if(indexed.results){
   if(!catalogueRequiresPagedResearchTables(await catalogueFormat(store.db))&&await pagedTableDocument(document))fail();
   await (await RecordResultIndex.open(document,{signal})).verify({signal});
  }
 });
}
