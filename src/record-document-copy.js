// Copy owned values into the destination notebook's block store. A moved record
// must never depend on another notebook's encryption key for a restored version.
import {retainRecordContainer} from './record-tree-values.js';
import {retainRecordText} from './record-text-retention.js';
import {AppError} from './errors.js';
export async function copyRecordValue(source,destination,revision,{signal}={}){
 signal?.throwIfAborted();const node=await source.tree.node(revision);
 if(node.type==='inline')return destination.tree.retain(node.value);
 if(node.type==='string')return retainRecordText(destination.blocks,source.tree.text(revision,[],{signal}),{signal});
 if(!['array','object'].includes(node.type))throw new AppError('CATALOGUE_DAMAGED');
 async function* children(){for await(const child of source.tree.children(node)){
  signal?.throwIfAborted();if(child.type!==(node.type==='array'?'item':'property'))throw new AppError('CATALOGUE_DAMAGED');
  yield {...(node.type==='object'?{name:child.name}:{}),value:await copyRecordValue(source,destination,child.value,{signal})};
 }}
 return retainRecordContainer(destination.blocks,node.type,children(),{signal});
}
