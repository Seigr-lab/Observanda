// Point edits preserve all other immutable chunks and their historical roots.
import {AppError} from './errors.js';
export async function changeGraphSequence(sequences,value,offset,item,{remove=false}={}){
 sequences.validate(value);if(!Number.isSafeInteger(offset)||offset<0||offset>value.count||remove&&(offset!==value.count-1||item!==undefined))throw new AppError('INVALID');
 if(offset===value.count){if(remove)throw new AppError('INVALID');return sequences.append(value,[item]);}
 const start=offset-offset%value.chunkSize,chunk=await sequences.page(value,{offset:start,limit:Math.min(value.chunkSize,value.count-start)}),items=chunk.items;
 if(remove)items.pop();else items[offset-start]=item;
 const tree=sequences.tree(),key='chunk:'+String(Math.floor(offset/value.chunkSize)).padStart(16,'0');let root;
 if(items.length){const revision=await sequences.put('chunks',{kind:value.kind,offset:start,items});root=await tree.change(value.root,key,revision);}
 else root=await tree.change(value.root,key,null);
 await tree.flush(root);return sequences.validate({...value,root,count:value.count-(remove?1:0)});
}
