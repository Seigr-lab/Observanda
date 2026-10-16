// Keep included values under their source positions. Removing an early result
// changes one index branch; logical array positions are resolved by rank, so
// later results keep their immutable references without being renumbered.
import {collectionChanges,sameItemFields} from './record-projection-dependency.js';
import {RecordSequenceBuilder} from './record-tree-values.js';
import {AppError} from './errors.js';
const ordinal=value=>String(value).padStart(16,'0');
export async function filterRecordProjection(document,previous,{path,collection,fields,include,project},{signal}={}){
 signal?.throwIfAborted();const {tree,blocks}=document,total=await tree.arrayLength(document.root,collection);
 const valueAt=async position=>{
  signal?.throwIfAborted();const item={},ref=await document.reference([...collection,String(position)],{signal});
  for(const name of fields){const selected=await tree.selected(ref,[name]);if(selected.found)Object.defineProperty(item,name,{value:selected.value,enumerable:true});}
  return include(item)?blocks.put('value',{type:'item',value:await tree.retain(project(item))}):null;
 };
 const prior=previous?await previous.tree.select(previous.root,path):null,node=prior&&!prior.inline?await previous.tree.node(prior.revision):null;
 const changes=node?.type==='keyed-array'?await collectionChanges(document,previous.document,collection,{signal}):null;
 if(changes?.unchanged)return prior.revision;
 let root;
 if(!changes){
  const builder=new RecordSequenceBuilder(blocks);
  for(let position=0;position<total;position++){const revision=await valueAt(position);if(revision)await builder.append(0,{id:ordinal(position),revision});}
  root=await builder.finishIndex();
 }else{
  root=node.root;let batch=[];
  const flush=async()=>{root=await tree.index.changeMany(root,batch,{signal});await tree.index.flush(root);batch=[];};
  for await(const position of changes.positions()){
   signal?.throwIfAborted();
   if(position<Math.min(total,changes.beforeTotal)&&await sameItemFields(document,previous.document,collection,position,fields,{signal}))continue;
   batch.push({id:ordinal(position),revision:position<total?await valueAt(position):null});if(batch.length===32)await flush();
  }
  if(batch.length)await flush();
 }
 if(root&&(!total||root.count>total||root.first<ordinal(0)||root.last>ordinal(total-1)))throw new AppError('CATALOGUE_DAMAGED');
 signal?.throwIfAborted();return blocks.put('value',{type:'keyed-array',root});
}
