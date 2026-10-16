// Reference destinations retain the author's order. Each request reads a
// bounded set of source owners, and at most one writing value at a time.
import {bookSelectors,validBookSelector} from './web/book-selectors.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function recordSelectorPage(document,{position={source:0,within:0,emitted:0},search='',signal}={}){
 signal?.throwIfAborted();
 const sizes=[];for(const name of ['sections','figures','attachments'])sizes.push(await document.tree.arrayLength(document.root,[name]));
 const [sections,figures,attachments]=sizes,total=sections*2+figures+attachments+1;
 if(!Number.isSafeInteger(total)||position.source>total)damaged();
 const selected=async path=>{signal?.throwIfAborted();return (await document.field(path,{signal})).value;};
 const values=async source=>{
  if(source<sections)return [{version:1,kind:'section',id:await selected(['sections',String(source),'id']),label:await selected(['sections',String(source),'title'])}];
  source-=sections;
  if(source<figures)return [{version:1,kind:'figure',id:await selected(['figures',String(source),'id']),label:await selected(['figures',String(source),'title'])}];
  source-=figures;
  if(source<attachments){const path=['attachments',String(source)];return await selected([...path,'kind'])==='image'?[{version:1,kind:'figure',id:await selected([...path,'id']),label:await selected([...path,'caption'])||await selected([...path,'alt'])}]:[];}
  source-=attachments;
  return bookSelectors({body:await selected(source===0?['body']:['sections',String(source-1),'body'])});
 };
 const items=[],needle=search.trim().toLocaleLowerCase();let {source,within,emitted}=position,read=0;
 while(source<total&&read<32&&items.length<20){
  signal?.throwIfAborted();const selectors=await values(source);read++;
  if(within>selectors.length)damaged();
  while(within<selectors.length&&items.length<20){
   signal?.throwIfAborted();const item=selectors[within++],{label,...selector}=item;
   if(!validBookSelector(selector)||typeof label!=='string')damaged();
   if(!needle||label.toLocaleLowerCase().includes(needle))items.push(item);
  }
  if(within===selectors.length){source++;within=0;}
 }
 signal?.throwIfAborted();
 return {items,first:items.length?emitted+1:0,last:emitted+items.length,next:source<total?{source,within,emitted:emitted+items.length}:null};
}
