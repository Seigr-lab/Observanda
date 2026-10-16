import {AppError} from './errors.js';

// Operates on the structure command's private snapshot. The workspace adapter
// owns the atomic save, concurrency check and recoverable history revision.
export function deleteLabBook(book,choice){
 const fields=['id','records','destinationId','confirmed'];
 if(!choice||typeof choice!=='object'||Array.isArray(choice)||Object.keys(choice).length!==fields.length||!fields.every(k=>Object.hasOwn(choice,k))||choice.confirmed!==true||!['empty','move','delete'].includes(choice.records))throw new AppError('INVALID');
 const source=book.notebooks.find(n=>n.id===choice.id);
 if(!source)throw new AppError('INVALID');
 const records=book.entries.filter(e=>e.notebookId===source.id);
 const destination=book.notebooks.find(n=>n.id===choice.destinationId&&n.id!==source.id);
 if((choice.records==='empty'&&records.length)||(choice.records==='move'&&!destination)||(choice.records!=='move'&&choice.destinationId!==null))throw new AppError('INVALID');
 const removed=new Set(['notebook:'+source.id]);
 if(choice.records==='move'){
  for(const record of records){
   record.notebookId=destination.id;
   if(source.projectId!==destination.projectId)record.share=false;
  }
 }else if(choice.records==='delete'){
  for(const record of records)removed.add('entry:'+record.id);
  book.entries=book.entries.filter(e=>e.notebookId!==source.id);
 }
 book.notebooks=book.notebooks.filter(n=>n.id!==source.id);
 book.branding=book.branding.filter(item=>!removed.has(item.target));
 book.website.layouts=book.website.layouts.filter(item=>!removed.has(item.target));
 const navigation=book.website.navigation;
 book.website.navigation=navigation.filter(item=>!removed.has(item.target)).map(item=>{
  if(!removed.has(item.parent))return item;
  let parent=item.parent;
  while(removed.has(parent))parent=navigation.find(n=>n.target===parent)?.parent??null;
  return {...item,parent};
 });
 // External/internal research references keep their stable IDs and resolve as
 // unavailable. Media and history are retained; they may still be referenced.
 return book;
}
