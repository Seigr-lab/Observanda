import {withProjectRecordBlockOwner} from './project-retired-records.js';
// Large derived documents share the record's authenticated value-block owner.
// Browse requests read their chosen fields, not every label, reference or byte
// of searchable prose belonging to the selected record.
import {RecordBlockStore} from './record-block-store.js';
import {catalogueFormat,requireRecordQueryBlocks} from './catalogue-format.js';
import {digest,serialize} from './storage-format.js';
import {jsonFitsBytes} from './web/json-chunks.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
import {validSearchVocabulary} from './record-search-vocabulary.js';
import {validReferenceIndex} from './record-reference-index.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const format='observanda-record-query-blocks';
const optional={searchText:'search',referenceTargets:'references',cardSources:'cardSources',publication:'publication',publicationCard:'cards',publicationDescriptor:'publicationDetails',editionInventory:'inventory'};

export async function retainQueryValue(store,value){
 if(jsonFitsBytes(value,65535,{pretty:true}))return value;
 const generation=1,key=await store.scopeKey(value.notebookId,generation,{create:true});
 try{
  const blocks=new RecordBlockStore(store,value.notebookId,generation,key),root=await blocks.tree().retain(value);
  await requireRecordQueryBlocks(store.db);await blocks.flush();
  return {format,version:1,id:value.id,notebookId:value.notebookId,generation,root};
 }finally{key.fill(0);}
}
export async function withQueryValue(store,value,source,row,consume){
 if(!value||value.id!==row.id||value.notebookId!==row.notebookId||digest(serialize(value))!==source.revision)fail();
 if(value.format!==format)return consume({value,tree:null});
 if(await catalogueFormat(store.db)<5)fail();
 // Version 1 holds a summary or an oversized plain query document; version 6
 // holds a full query document with its search vocabulary and reference index.
 const keys=['format','generation','id','notebookId','root','version',...(value.version===6?['referenceIndex','vocabulary']:[])].sort().join();
 if(![1,6].includes(value.version)||Object.keys(value).sort().join()!==keys||!Number.isSafeInteger(value.generation)||value.generation<1||!revisionId(value.root))fail();
 if(value.version===6&&(!validSearchVocabulary(value.vocabulary)||!validReferenceIndex(value.referenceIndex)||await catalogueFormat(store.db)<20))fail();
 return withProjectRecordBlockOwner(store,value.notebookId,value.generation,async owner=>{
 const key=await owner.scopeKey(value.notebookId,value.generation);
 try{
  const tree=new RecordBlockStore(owner,value.notebookId,value.generation,key).tree();
  for(const field of ['id','notebookId'])if((await tree.selected(value.root,[field])).value!==row[field])fail();
  if(value.version===6){const text=await tree.select(value.root,['searchText']);if(!text||text.inline||text.revision!==value.vocabulary.text)fail();
   const references=await tree.select(value.root,['referenceTargets']);if(!references||references.inline||references.revision!==value.referenceIndex.root)fail();}
  return await consume({value,tree});
 }finally{key.fill(0);}
 });
}
export async function queryTextMatches(chunks,needle,{signal}={}){
 let tail='',matched=!needle;
 for await(const chunk of chunks){
  signal?.throwIfAborted();if(matched)continue;
  const text=tail+chunk;matched=text.includes(needle);tail=needle.length>1?text.slice(-(needle.length-1)):'';
 }
 // Exhaust the string even after a match: malformed trailing blocks must not
 // produce a successful authenticated search result.
 return matched;
}
export async function readQueryValue(store,value,source,row,options){
 return withQueryValue(store,value,source,row,async({value,tree})=>{
  if(options.matching){
   const chunks=tree?tree.text(value.root,['searchText'],options):[value.searchText];
   if(!tree&&typeof value.searchText!=='string')fail();
   if(!await queryTextMatches(chunks,options.matching,options))return null;
  }
  if(!tree)return value;
  const document={};
  for(const field of await tree.propertyNames(value.root)){
   if(Object.hasOwn(optional,field)&&!options[optional[field]]&&!options.stored)continue;
   if(field==='searchText'&&!options.search)continue;
   options.signal?.throwIfAborted();const selected=await tree.selected(value.root,[field]);if(!selected.found)fail();
   Object.defineProperty(document,field,{value:selected.value,enumerable:true,writable:true,configurable:true});
  }
  if(document.id!==row.id||document.notebookId!==row.notebookId)fail();return document;
 });
}
