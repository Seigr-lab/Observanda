// Project zero or more values from each source field/item. Keys retain source
// group, source position and output position; logical array rank stays dense.
// Changing one group never renumbers or reads the output of later groups.
import {collectionChanges,sameItemFields} from './record-projection-dependency.js';
import {RecordSequenceBuilder} from './record-tree-values.js';
import {AppError} from './errors.js';
const ordinal=value=>String(value).padStart(16,'0');
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function groupRecordProjection(document,previous,{path,groups,previousRoot},{signal}={}){
 signal?.throwIfAborted();const {tree,blocks}=document,selected=previousRoot?{revision:previousRoot}:previous?await previous.tree.select(previous.root,path):null,node=selected&&!selected.inline?await tree.node(selected.revision):null;
 const reuse=node?.type==='keyed-array',before=reuse?node.root:null,builder=reuse?null:new RecordSequenceBuilder(blocks);let root=before,batch=[];
 const flush=async()=>{root=await tree.index.changeMany(root,batch,{signal});await tree.index.flush(root);batch=[];};
 const write=async(id,revision)=>{
  if(builder){if(revision)await builder.append(0,{id,revision});return;}
  batch.push({id,revision});if(batch.length===32)await flush();
 };
 const length=async(source,path)=>await source.reference(path,{signal})?source.tree.arrayLength(source.root,path):0;
 for(const [groupIndex,group] of groups.entries()){
  signal?.throwIfAborted();let changes=null,total=1;
  if(group.collection){
   changes=reuse?await collectionChanges(document,previous.document,group.collection,{signal}):null;
   if(changes?.unchanged)continue;total=await length(document,group.collection);
  }else if(reuse&&await document.reference(group.field,{signal})===await previous.document.reference(group.field,{signal}))continue;
  const oldTotal=reuse&&group.collection&&!changes?await length(previous.document,group.collection):0;
  const positions=changes?changes.positions():(async function*(){for(let i=0;i<Math.max(total,oldTotal);i++)yield i;})();
  for await(const position of positions){
   signal?.throwIfAborted();
   if(changes&&position<Math.min(total,changes.beforeTotal)&&await sameItemFields(document,previous.document,group.collection,position,group.fields,{signal}))continue;
   const prefix=ordinal(groupIndex)+':'+ordinal(position)+':';
   let value;
   if(position<total){
    if(group.collection){
     value={};const ref=await document.reference([...group.collection,String(position)],{signal});
     for(const name of group.fields){const item=await tree.selected(ref,[name]);if(item.found)Object.defineProperty(value,name,{value:item.value,enumerable:true});}
    }else value=group.read?await group.read(document,{signal}):(await document.field(group.field,{signal})).value;
   }
   let sourceRank=before?await tree.index.rank({root:before},prefix):0,output=0,old=before?await tree.index.entryAt({root:before},sourceRank):null;
   for await(const item of position<total?group.project(value):[]){
    signal?.throwIfAborted();if(!Number.isSafeInteger(output+1))fail();const id=prefix+ordinal(output++);
    if(old?.id.startsWith(prefix)){if(old.id!==id)fail();old=await tree.index.entryAt({root:before},++sourceRank);}
    await write(id,await blocks.put('value',{type:'item',value:await tree.retain(item)}));
   }
   while(old?.id.startsWith(prefix)){
    signal?.throwIfAborted();const id=prefix+ordinal(output++);if(old.id!==id)fail();await write(id,null);old=await tree.index.entryAt({root:before},++sourceRank);
   }
  }
 }
 if(builder)root=await builder.finishIndex();else if(batch.length)await flush();
 signal?.throwIfAborted();return blocks.put('value',{type:'keyed-array',root});
}
