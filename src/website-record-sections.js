import {AppError} from './errors.js';
import {withRecordDocument} from './record-document.js';
import {withQueryValue} from './record-query-storage.js';
import {memberCollectionCount} from './record-member-collections.js';
import {sectionAnchor} from './web/record-workflow.js';
import {SOURCE_PUBLICATION_VERSION,sourceRecordAllowed} from './web/source-publication-permissions.js';

// Public link destinations read the filtered immutable label index. Large
// bodies, figures and unrelated records never enter this destination picker.
export async function websiteRecordSections(store,snapshot,recordId,offset,{signal}={}){
 const row=await store.member(snapshot,recordId);if(!row)throw new AppError('NOT_FOUND');
 const limit=25;if(!Number.isSafeInteger(offset)||offset<0||offset%limit)throw new AppError('INVALID');
 const page=(items,total)=>{
  if(offset>=total&&offset!==0)throw new AppError('INVALID');
  return {items,total,offset,previous:offset?Math.max(0,offset-limit):null,next:offset+items.length<total?offset+limit:null};
 };
 const label=(item,position)=>({id:sectionAnchor(item),title:item.title,position});
 const fallback=()=>withRecordDocument(store,row.id,row.revision,async document=>{
  const share=(await document.field(['share'],{signal})).value,notebookId=(await document.field(['notebookId'],{signal})).value,items=[];let total=0;
  if(sourceRecordAllowed({share,notebookId},snapshot.metadata))for(let i=0;i<memberCollectionCount(row,'sections');i++){
   signal?.throwIfAborted();const path=['sections',String(i)];
   if((await document.field([...path,'share'],{signal}))?.value===false)continue;
   if(total>=offset&&items.length<limit){
    const id=(await document.field([...path,'id'],{signal})).value,title=(await document.field([...path,'title'],{signal})).value;
    items.push(label({id,title},total));
   }
   total++;
  }
  return page(items,total);
 });
 if(!row.queryRevision)return fallback();
 const source={slot:'record-query:'+row.id+':'+row.queryRevision,revision:row.queryRevision},stored=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
 return withQueryValue(store,store.decode('state',source.slot,stored?.payload),source,row,async({value,tree})=>{
  if(!tree){
   if(value.editionInventory?.sourcePermissionVersion!==SOURCE_PUBLICATION_VERSION)return fallback();
   if(!sourceRecordAllowed(value,snapshot.metadata))return page([],0);
   const sections=value.editionInventory.sections;if(!Array.isArray(sections))throw new AppError('CATALOGUE_DAMAGED');
   return page(sections.slice(offset,offset+limit).map((item,index)=>label(item,offset+index)),sections.length);
  }
  if((await tree.selected(value.root,['editionInventory','sourcePermissionVersion']))?.value!==SOURCE_PUBLICATION_VERSION)return fallback();
  const share=(await tree.selected(value.root,['share'])).value;
  if(!sourceRecordAllowed({share,notebookId:row.notebookId},snapshot.metadata))return page([],0);
  signal?.throwIfAborted();const indexed=await tree.page(value.root,['editionInventory','sections'],{offset,limit});signal?.throwIfAborted();
  return page(indexed.values.map((item,index)=>label(item,offset+index)),indexed.total);
 });
}
