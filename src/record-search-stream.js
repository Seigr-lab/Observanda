// Search vocabulary grows on encrypted scratch storage; record prose stays in
// its retained byte windows. Common small vocabularies require no scratch I/O.
import {withQueryValue} from './record-query-storage.js';
import {withScratch} from './scratch-work.js';
import {grams,referenceTerm} from './record-search-terms.js';
import {AppError} from './errors.js';
import {scopedIterator} from './scoped-iterator.js';
import {serialize} from './storage-format.js';
import {changedSearchVocabulary} from './record-search-vocabulary.js';
import {changedReferenceTerms} from './record-reference-index.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};

async function withQuery(store,row,metadata,consume,{signal}={}){
 signal?.throwIfAborted();
 if(!row.queryRevision){
  for await(const value of store.queryDocuments([row],metadata,{signal,search:true,references:true}))return consume({value,tree:null});
  fail();
 }
 const source={revision:row.queryRevision,slot:'record-query:'+row.id+':'+row.queryRevision};
 const found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
 return withQueryValue(store,store.decode('state',source.slot,found?.payload),source,row,consume);
}
async function* rawTerms({value,tree},version,{signal}={},selection={text:true,references:true}){
 const text=selection.text?(tree?tree.text(value.root,['searchText'],{signal}):[value.searchText]):[];let tail='';
 for await(const chunk of text){
  signal?.throwIfAborted();if(typeof chunk!=='string')fail();
  for(let offset=0;offset<chunk.length;offset+=2048){
   const window=tail+chunk.slice(offset,offset+2048);
   for(const width of [1,2,3])yield* grams(window,width);
   tail=window.slice(-2);
  }
 }
 if(version===2&&selection.references){
  if(!tree){for(const target of value.referenceTargets??[])yield referenceTerm(target);}
  else{
   const count=await tree.arrayLength(value.root,['referenceTargets']);
   for(let offset=0;offset<count;offset+=32){
    signal?.throwIfAborted();const page=await tree.page(value.root,['referenceTargets'],{offset,limit:32});
    for(const target of page.values)yield referenceTerm(target);
   }
  }
 }
}
// Query roots and field descriptors are authenticated before comparing them.
// Equal immutable references need no term enumeration. Full audits still read
// every text block and reference through withRecordTerms.
async function fieldIdentity({value,tree},field,{signal}={}){
 signal?.throwIfAborted();let selected,node;
 if(tree){
  selected=await tree.select(value.root,[field]);if(!selected)fail();
  node=selected.inline?{type:'inline',value:selected.value}:await tree.node(selected.revision);
 }else node={type:'inline',value:field==='referenceTargets'?value[field]??[]:value[field]};
 if(node.type==='inline'){
  if(field==='searchText'?typeof node.value!=='string':!Array.isArray(node.value))fail();
  return 'inline:'+serialize(node.value);
 }
 if(field==='searchText'?!['string','joined-string'].includes(node.type):!['array','keyed-array'].includes(node.type))fail();
 return 'retained:'+value.notebookId+':'+value.generation+':'+selected.revision;
}
function queryNotebook(source,row){
 const notebookId=source.value.notebookId;if(row.notebookId!==undefined&&notebookId!==row.notebookId)fail();return notebookId;
}
async function withUniqueTerms(source,consume,{signal}={}){
 const iterator=source[Symbol.asyncIterator](),memory=new Set();let item;
 try{
  while(!(item=await iterator.next()).done){
   signal?.throwIfAborted();memory.add(item.value);
   if(memory.size>8192)break;
  }
  if(item.done)return consume({items:()=>memory.values(),hasMany:async values=>new Set(values.filter(v=>memory.has(v)))});
  return await withScratch(async work=>{
   let pending=new Map();
   const flush=async()=>{if(pending.size){await work.putMany([...pending]);pending.clear();}};
   for(const term of memory){pending.set(term,term);if(pending.size===32)await flush();}await flush();
   // This cache is only an I/O shortcut. The scratch primary key provides the
   // exact uniqueness proof even after a term leaves the bounded cache.
   while(!(item=await iterator.next()).done){
    signal?.throwIfAborted();const term=item.value;if(memory.has(term))continue;
    if(memory.size>=8192)memory.delete(memory.values().next().value);memory.add(term);
    pending.set(term,term);if(pending.size===32)await flush();
   }
   await flush();
   return consume({items:()=>work.items(),hasMany:async values=>new Set((await work.getMany(values)).keys())});
  },{signal});
 }finally{await iterator.return?.();}
}
export async function withRecordTerms(store,row,metadata,version,consume,options={}){
 return withQuery(store,row,metadata,async source=>{
  const notebookId=queryNotebook(source,row);
  return withUniqueTerms(rawTerms(source,version,options),bag=>consume({...bag,notebookId}),options);
 },options);
}
export function recordTerms(store,row,metadata,version,options={}){
 return scopedIterator(consume=>withRecordTerms(store,row,metadata,version,consume,options),async function*(bag){
  for await(const term of bag.items())yield {term,notebookId:bag.notebookId};
 });
}
export async function withChangedRecordTerms(store,row,metadata,other,otherMetadata,version,consume,options={}){
 if(!other)return withRecordTerms(store,row,metadata,version,own=>consume(own.items(),own.notebookId),options);
 return withQuery(store,row,metadata,source=>{
  const notebookId=queryNotebook(source,row);
  return withQuery(store,other,otherMetadata,async opposite=>{
   queryNotebook(opposite,other);
   const selection={text:await fieldIdentity(source,'searchText',options)!==await fieldIdentity(opposite,'searchText',options),references:version===2&&await fieldIdentity(source,'referenceTargets',options)!==await fieldIdentity(opposite,'referenceTargets',options)};
   const retained=!options.audit&&source.tree&&opposite.tree&&source.value.vocabulary&&opposite.value.vocabulary&&source.value.notebookId===opposite.value.notebookId&&source.value.generation===opposite.value.generation;
   const vocabulary=retained&&selection.text; if(vocabulary)selection.text=false;
   const references=retained&&selection.references&&source.value.referenceIndex&&opposite.value.referenceIndex;if(references)selection.references=false;
   // Text grams are hexadecimal; reference keys begin with "ref-". These
   // disjoint vocabularies allow unchanged domains to be omitted from both bags.
   return withUniqueTerms(rawTerms(source,version,options,selection),own=>withUniqueTerms(rawTerms(opposite,version,options,selection),skip=>{
    async function* difference(){
     if(vocabulary)yield* changedSearchVocabulary(source.tree.storage,source.value.vocabulary,opposite.value.vocabulary,options);
     if(references)yield* changedReferenceTerms(source.tree.storage,source.value.referenceIndex,opposite.value.referenceIndex,options);
     let batch=[];
     async function* flush(){const found=await skip.hasMany(batch);for(const term of batch)if(!found.has(term))yield term;batch=[];}
     for await(const term of own.items()){options.signal?.throwIfAborted();batch.push(term);if(batch.length===32)yield* flush();}
     if(batch.length)yield* flush();
    }
    return consume(difference(),notebookId);
   },options),options);
  },options);
 },options);
}
