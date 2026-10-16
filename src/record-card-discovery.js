import {AppError} from './errors.js';
import {withQueryValue} from './record-query-storage.js';
import {RecordDocument,withRecordDocument} from './record-document.js';
import {researchCardFields,researchCardItems} from './web/research-card-items.js';
import {discoveryMatches} from './web/data-discovery.js';
// A nested source finder retains only labels for its visible page. Large
// projected label arrays are traversed through their immutable value blocks.
export async function recordCardDiscovery(store,row,summary,{provider,search,offset,limit,signal}){
 const selected=provider==='media'?'files':provider,field=researchCardFields[provider],remaining=search.trim().split(/\s+/).filter(word=>word&&!summary.title.toLocaleLowerCase().includes(word.toLocaleLowerCase())).join(' ');
 const collect=async(count,iterate)=>{
  const items=[];let total=remaining?0:count;
  for await(const source of iterate(remaining?0:offset,remaining?Infinity:limit)){
   signal?.throwIfAborted();const item={...source,subtitle:summary.title};if(!discoveryMatches(item,remaining))continue;
   if(!remaining||total>=offset&&items.length<limit)items.push(item);if(remaining)total++;
  }
  return {items,total};
 };
 const fallback=()=>withRecordDocument(store,row.id,row.revision,async document=>{
  const count=await document.tree.arrayLength(document.root,[field]);
  return collect(count,async function*(start,size){for await(const item of document.items([field],{offset:start,limit:size,signal})){
   const data={};for(const name of ['id','title','name','caption','kind','label','type']){const value=await document.tree.selected(item.value,[name]);if(value.found)data[name]=value.value;}
   const [source]=researchCardItems(provider,{id:row.id,title:summary.title,[field]:[data]});yield {key:source.key,title:source.title};
  }});
 });
 if(!row.queryRevision)return fallback();
 const source={slot:'record-query:'+row.id+':'+row.queryRevision,revision:row.queryRevision},stored=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
 return withQueryValue(store,store.decode('state',source.slot,stored?.payload),source,{...row,notebookId:summary.notebookId},async({value,tree})=>{
  if(!tree){const values=value.cardSources?.[selected];if(values===undefined)return fallback();if(!Array.isArray(values))throw new AppError('CATALOGUE_DAMAGED');return collect(values.length,async function*(start,size){for(let i=start;i<Math.min(values.length,start+size);i++)yield values[i];});}
  if(!await tree.select(value.root,['cardSources',selected]))return fallback();
  const document=new RecordDocument({tree:()=>tree},value.root),count=await tree.arrayLength(value.root,['cardSources',selected]);
  return collect(count,async function*(start,size){for await(const item of document.items(['cardSources',selected],{offset:start,limit:size,signal}))yield (await tree.selected(item.value,[])).value;});
 });
}
