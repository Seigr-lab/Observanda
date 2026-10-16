// Check only the fields used by a derived collection. A changed point array,
// transcript or section body need not invalidate unrelated names and IDs.
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const ordinal=value=>String(value).padStart(16,'0');

export async function collectionChanges(document,previous,collection,{signal}={}){
 signal?.throwIfAborted();
 const a=await previous.reference(collection,{signal}),b=await document.reference(collection,{signal});
 if(a===b)return {unchanged:true};if(!a||!b)return null;
 const old=await previous.tree.node(a),next=await document.tree.node(b);
 const count=node=>node.type==='array'?node.root?.count??0:node.type==='inline'&&Array.isArray(node.value)?node.value.length:null;
 const beforeTotal=count(old),total=count(next);if(beforeTotal===null||total===null)damaged();
 async function* positions(){
  if(old.type==='array'&&next.type==='array'){
   for await(const change of document.tree.index.differences(old.root,next.root,{signal})){
    const position=Number(change.id);
    if(!Number.isSafeInteger(position)||position<0||change.before&&position>=beforeTotal||change.after&&position>=total||change.id!==ordinal(position))damaged();
    yield position;
   }
  }else{
   // At least one side is a bounded inline value. Its full item count is small;
   // retaining or upgrading its representation cannot force a corpus read.
   for(let position=0;position<Math.max(beforeTotal,total);position++){signal?.throwIfAborted();yield position;}
  }
 }
 return {unchanged:false,beforeTotal,total,positions};
}
export async function sameItemFields(document,previous,collection,position,fields,{signal}={}){
 const path=[...collection,String(position)],a=await previous.reference(path,{signal}),b=await document.reference(path,{signal});
 if(a===b)return true;if(!a||!b)return false;
 for(const name of fields){
  signal?.throwIfAborted();const old=await previous.tree.select(a,[name]),next=await document.tree.select(b,[name]);
  const reference=async(tree,value)=>!value?null:value.inline?tree.retain(value.value):value.revision;
  if(await reference(previous.tree,old)!==await reference(document.tree,next))return false;
 }
 return true;
}
export async function sameCollectionFields(document,previous,{collection,fields},options={}){
 const changes=await collectionChanges(document,previous,collection,options);if(!changes)return false;if(changes.unchanged)return true;
 if(changes.beforeTotal!==changes.total)return false;
 for await(const position of changes.positions())if(!await sameItemFields(document,previous,collection,position,fields,options))return false;
 return true;
}
