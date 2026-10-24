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

// Explicit author-directed shifts keep only one carried item in memory and
// preserve every unaffected immutable chunk. Scientific ordering is validated
// by the owning model before execution.
export async function moveGraphSequence(sequences,value,from,to,{signal}={}){
 sequences.validate(value);if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<0||from>=value.count||to>=value.count)throw new AppError('INVALID');
 const item=await sequences.item(value,from),direction=to>from?1:-1;let next=value;
 for(let at=from;at!==to;at+=direction){signal?.throwIfAborted();next=await changeGraphSequence(sequences,next,at,await sequences.item(value,at+direction));}
 signal?.throwIfAborted();return changeGraphSequence(sequences,next,to,item);
}
export async function removeGraphSequence(sequences,value,offset,{signal}={}){
 sequences.validate(value);if(!Number.isSafeInteger(offset)||offset<0||offset>=value.count)throw new AppError('INVALID');let next=value;
 for(let at=offset;at<value.count-1;at++){signal?.throwIfAborted();next=await changeGraphSequence(sequences,next,at,await sequences.item(value,at+1));}
 signal?.throwIfAborted();return changeGraphSequence(sequences,next,value.count-1,undefined,{remove:true});
}
