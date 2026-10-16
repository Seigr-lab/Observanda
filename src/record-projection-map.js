// A one-to-one projection preserves source ordinals. Amend only changed output
// slots, append new slots and remove old tail slots. Context changes and missing
// older projections fall back to the streaming builder.
import {collectionChanges,sameItemFields} from './record-projection-dependency.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {AppError} from './errors.js';
export async function mapRecordProjection(document,previous,{path,collection,fields,context,project},build,{signal}={}){
 signal?.throwIfAborted();if(!previous)return build();
 for(const owner of context)if(await document.reference(owner,{signal})!==await previous.document.reference(owner,{signal}))return build();
 const source=await previous.tree.select(previous.root,path);if(!source)return build();
 const root=source.inline?await document.tree.retain(source.value):source.revision;
 const changes=await collectionChanges(document,previous.document,collection,{signal});if(!changes)return build();if(changes.unchanged)return root;
 if(await previous.tree.arrayLength(previous.root,path)!==changes.beforeTotal)return build();
 let retained=root,node=await document.tree.node(root);
 if(node.type==='inline'){
  const builder=new RecordContainerBuilder(document.blocks,'array');
  for(const value of node.value){signal?.throwIfAborted();await builder.add({value:await document.tree.retain(value)});}
  retained=await builder.finish();node=await document.tree.node(retained);
 }
 let result=node.root,pending=0,changed=false;
 for await(const position of changes.positions()){
  signal?.throwIfAborted();const key=String(position).padStart(16,'0');
  if(position>=changes.total)result=await document.tree.index.remove(result,key);
  else{
   if(position<changes.beforeTotal&&await sameItemFields(document,previous.document,collection,position,fields,{signal}))continue;
   const item={},ref=await document.reference([...collection,String(position)],{signal});
   for(const name of fields){const selected=await document.tree.selected(ref,[name]);if(selected.found)Object.defineProperty(item,name,{value:selected.value,enumerable:true});}
   const value=await document.tree.retain(project(item)),child=await document.blocks.put('value',{type:'item',value});
   result=await document.tree.index.change(result,key,child);
  }
  changed=true;if(++pending===32){await document.tree.index.flush(result);pending=0;}
 }
 signal?.throwIfAborted();if(!changed)return root;
 if((result?.count??0)!==changes.total||result&&(result.first!=='0'.repeat(16)||result.last!==String(changes.total-1).padStart(16,'0')))throw new AppError('CATALOGUE_DAMAGED');
 await document.tree.index.flush(result);return document.blocks.put('value',{type:'array',root:result});
}
