import {AppError} from './errors.js';
import {withRecordDocument} from './record-document.js';
import {memberCollectionCount} from './record-member-collections.js';
import {sectionAnchor} from './web/record-workflow.js';

// Read only section identities and labels from the selected snapshot. Large
// bodies, figures and unrelated records never enter this destination picker.
export async function websiteRecordSections(store,snapshot,recordId,offset,{signal}={}){
 const row=await store.member(snapshot,recordId);if(!row)throw new AppError('NOT_FOUND');
 const total=memberCollectionCount(row,'sections'),limit=25;
 if(!Number.isSafeInteger(offset)||offset<0||offset%limit||offset>=total&&offset!==0)throw new AppError('INVALID');
 return withRecordDocument(store,row.id,row.revision,async document=>{
  const items=[];
  for(let i=offset;i<Math.min(total,offset+limit);i++){
   signal?.throwIfAborted();const path=['sections',String(i)];
   const id=(await document.field([...path,'id'],{signal})).value,title=(await document.field([...path,'title'],{signal})).value;
   items.push({id:sectionAnchor({id}),title,position:i});
  }
  return {items,total,offset,previous:offset?Math.max(0,offset-limit):null,next:offset+items.length<total?offset+limit:null};
 });
}
