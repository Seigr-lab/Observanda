// Query text and browse summaries have separate immutable encrypted payloads.
// A filter, label lookup or dependency check never needs the original prose or
// its full search-text derivative. Snapshot membership authenticates both.
import {SOURCE_PUBLICATION_VERSION} from './web/source-publication-permissions.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {historicalRecordValue,recordRevision} from './research.js';
import {recordQueryDocument} from './web/record-query.js';
import {recordPublicationSummary} from './web/record-publication-summary.js';
import {publicationCard} from './web/publication-card.js';
import {recordEditionInventory} from './web/publication-inventory.js';
import {publicationDescriptorDetails} from './publication-record-descriptor.js';
import {recordWriteEncoding,recordWriteDisplay} from './record-write-encoding.js';
import {retainQueryValue,readQueryValue,withQueryValue} from './record-query-storage.js';
import {retainedQueryProjection} from './record-query-projection.js';
import {RecordBlockStore,recordBlockResource} from './record-block-store.js';
import {retainRecordOwnerResource} from './record-owner-resources.js';
import {RecordDocument,withRecordDocument} from './record-document.js';
import {jsonFitsBytes} from './web/json-chunks.js';
import {requireAttemptQueries} from './catalogue-format.js';
import {retainSearchVocabulary} from './record-search-vocabulary.js';
import {retainReferenceIndex} from './record-reference-index.js';
const hash=value=>digest(serialize(value));
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function browseDocument(document){const {searchText,...summary}=document;void searchText;return summary;}
const details={references:'referenceTargets',cardSources:'cardSources',publication:'publication',cards:'publicationCard',publicationDetails:'publicationDescriptor',inventory:'editionInventory'};
function retainedBrowseDocument(document){
 const summary=browseDocument(document);for(const field of Object.values(details))delete summary[field];return summary;
}
export class RecordQueryDocuments{
 constructor(store,{write=null}={}){if(write!==null&&typeof write!=='function')throw new AppError('INVALID');this.store=store;this.write=write;}
 async persistWith(operation){return this.write?this.write(operation):operation(this.store);}
 async retain(record,metadata,{previous=null}={}){
  const prepared=recordWriteEncoding(this.store,record,metadata),display=recordWriteDisplay(this.store,record,metadata)??historicalRecordValue(metadata,record),revision=prepared?.contentRevision??recordRevision(display);
  if(!jsonFitsBytes(display,65535,{pretty:true})){
   const generation=1,key=await this.store.scopeKey(display.notebookId,generation,{create:true});
   try{
    const blocks=new RecordBlockStore(this.store,display.notebookId,generation,key),root=await blocks.tree().retain(display);
    return await this.retainDocument(new RecordDocument(blocks,root),revision,{previous});
   }finally{key.fill(0);}
  }
  const document={...recordQueryDocument(display),publication:recordPublicationSummary(display),publicationCard:publicationCard(display),publicationDescriptor:{...publicationDescriptorDetails(display),revision},editionInventory:recordEditionInventory(display,revision),recordRevision:revision};
  return this.retainValues(record.id,document,retainedBrowseDocument(document));
 }
 async retainDocument(document,revision,options={}){
  const {blocks}=document,prior=options.previous;
  const project=async previous=>{
   const vocabulary=await retainSearchVocabulary(document,{signal:options.signal,previous}),referenceIndex=await retainReferenceIndex(document,{signal:options.signal,previous});
   return {...await retainedQueryProjection(document,revision,{signal:options.signal,previous,searchText:vocabulary.text,referenceTargets:referenceIndex.root}),vocabulary,referenceIndex};
  };
  let projection;
  if(prior?.queryRevision&&prior.notebookId===blocks.scopeId&&prior.id===(await document.field(['id'],{signal:options.signal})).value){
   const source={revision:prior.queryRevision,slot:'record-query:'+prior.id+':'+prior.queryRevision},row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
   projection=await withQueryValue(this.store,this.store.decode('state',source.slot,row?.payload),source,prior,({value,tree})=>{
    if(!tree||value.generation!==blocks.generation)return project(null);
    return withRecordDocument(this.store,prior.id,prior.revision,previous=>project({document:previous,tree,root:value.root,vocabulary:value.vocabulary,referenceIndex:value.referenceIndex}));
   });
  }else projection=await project(null);
  const {root,browse,summaryRoot,vocabulary,referenceIndex}=projection;
  await this.persistWith(store=>requireAttemptQueries(store.db));await blocks.flush();
  const descriptor={format:'observanda-record-query-blocks',version:1,id:browse.id,notebookId:browse.notebookId,generation:blocks.generation};
  return this.retainValues(browse.id,{...descriptor,version:6,root,vocabulary,referenceIndex},{...descriptor,root:summaryRoot});
 }
 async retainValues(id,document,browse){
  return this.persistWith(async store=>{
  const result={};
  for(const [field,kind,source] of [['queryRevision','record-query',document],['summaryRevision','record-summary',browse]]){
   const value=await retainQueryValue(store,source);
   const revision=hash(value),slot=kind+':'+id+':'+revision;
   const prior=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
   if(prior){if(hash(store.decode('state',slot,prior.payload))!==revision)damaged();}
   const dependencies=[];if(value.format==='observanda-record-query-blocks'){const ref=(kind,version)=>recordBlockResource(value.notebookId,value.generation,kind,version);dependencies.push(ref('value',value.root));if(value.vocabulary){for(const name of ['parts','terms'])if(value.vocabulary[name])dependencies.push(ref('index',value.vocabulary[name].hash));if(value.vocabulary.text)dependencies.push(ref('value',value.vocabulary.text));}if(value.referenceIndex){for(const name of ['occurrences','terms'])if(value.referenceIndex[name])dependencies.push(ref('index',value.referenceIndex[name].hash));for(const name of ['raw','root'])dependencies.push(ref('value',value.referenceIndex[name]));}}
   await retainRecordOwnerResource(store,{kind:'state',key:slot,revision},{present:!!prior,dependencies});
   if(!prior)await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,value));
   result[field]=revision;
  }
  return result;
  });
 }
 async *read(rows,metadata,{signal,references=false,revisions=false,cardSources=false,publication=false,cards=false,inventory=false,inventoryFallback=true,publicationDetails=false,search=true,stored=false,matching=''}={}){
  const owner=this;
  matching=matching.trim().toLocaleLowerCase();
  const options={signal,references,revisions,cardSources,publication,cards,inventory,publicationDetails,search,stored,matching};
  const missing=value=>Object.entries(details).some(([option,field])=>options[option]&&(option!=='inventory'||inventoryFallback)&&!Object.hasOwn(value,field));
  const descriptor=row=>{
   const summary=!search&&!matching&&(stored||!Object.keys(details).some(option=>options[option]))&&row.summaryRevision,revision=summary?row.summaryRevision:row.queryRevision;
   return revision?{revision,slot:(summary?'record-summary:':'record-query:')+row.id+':'+revision}:null;
  };
  const readBatch=async function*(batch){
   const slots=batch.map(descriptor).filter(Boolean).map(item=>item.slot);
   const found=new Map((await owner.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',slots)).map(row=>[row.slot,row.payload]));
   for(const row of batch){
    signal?.throwIfAborted();const source=descriptor(row);let value;
    if(source){
     value=await readQueryValue(owner.store,owner.store.decode('state',source.slot,found.get(source.slot)),source,row,options);
     if(value===null)continue;
    }
    if(!source||!stored&&(missing(value)||publicationDetails&&value.publicationDescriptor?.sourcePermissionVersion!==SOURCE_PUBLICATION_VERSION||inventory&&inventoryFallback&&value.editionInventory?.sourcePermissionVersion!==SOURCE_PUBLICATION_VERSION)){
     const display=historicalRecordValue(metadata,await owner.store.record(row.id,row.revision));
     const revision=recordRevision(display);value={...recordQueryDocument(display),publication:recordPublicationSummary(display),publicationCard:publicationCard(display),publicationDescriptor:{...publicationDescriptorDetails(display),revision},editionInventory:recordEditionInventory(display,revision),recordRevision:revision};
     if(matching&&!value.searchText.includes(matching))continue;
    }
    const {recordRevision:displayRevision,...document}=search?value:browseDocument(value);
    if(!references&&!stored)delete document.referenceTargets;
    if(!cardSources&&!stored)delete document.cardSources;
    if(!publication)delete document.publication;
    if(!cards)delete document.publicationCard;
    if(!inventory||!stored&&document.editionInventory?.sourcePermissionVersion!==SOURCE_PUBLICATION_VERSION)delete document.editionInventory;
    if(!publicationDetails)delete document.publicationDescriptor;
    yield revisions?{...document,revision:displayRevision??null,storageRevision:row.revision}:document;
   }
  };
  let batch=[],bytes=0;
  for await(const row of rows){
   signal?.throwIfAborted();
   // Older full query envelopes may still contain their original search text.
   // Include matching and detail requests in the byte budget even when the
   // caller does not return that text. New blocked envelopes are smaller.
   const size=descriptor(row)?.revision===row.summaryRevision?0:row.bytes;
   if(batch.length&&(batch.length===32||bytes+size>256*1024)){yield* readBatch(batch);batch=[];bytes=0;}
   batch.push(row);bytes+=size;
  }
  if(batch.length)yield* readBatch(batch);
 }
}
