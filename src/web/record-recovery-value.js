import {validRecordDate,recordDateLabel} from './record-date.js';
import {BOOK_BLOCKS,bookBlockText} from './book-blocks.js';
import {recordConflictLabel,recordRecoveryMessage} from './record-recovery-messages.js';

// Traverse source values by reference. A bookmark contains traversal positions,
// not a flattened figure, table, formatted document or previous rendered page.
function nextPart(stack,book,message){
 while(stack.length){
  const frame=stack.pop(),{value,field}=frame;
  if(frame.kind==='literal')return value;
  if(frame.kind==='children'){
   const length=frame.keys?.length??value.length;if(frame.index===length)continue;
   const index=frame.index++,key=frame.keys?.[index]??index;stack.push(frame);
   stack.push({kind:frame.rich?'rich':'value',value:value[key],field:frame.keys?key:field});
   if(frame.keys)stack.push({kind:'literal',value:recordConflictLabel(key,message)+': '});
   if(index&&frame.separator)stack.push({kind:'literal',value:frame.separator});
   continue;
  }
  if(frame.kind==='rich'){
   if(BOOK_BLOCKS.includes(value.type))return bookBlockText(value);
   if(value.type==='text')return value.text;
   if(value.type==='hard_break')return '\n';
   stack.push({kind:'children',value:value.content??[],index:0,rich:true,separator:['paragraph','heading'].includes(value.type)?'':'\n'});continue;
  }
  if(typeof value==='object'&&validRecordDate(value))return recordDateLabel(value);
  if(value?.type==='doc'){
   stack.push({kind:'literal',value:'\n'+message('formatted')},{kind:'rich',value});continue;
  }
  if(value===undefined)return message('removed');
  if(value===null)return message('none');
  if(typeof value==='number')return Object.is(value,-0)?'-0':String(value);
  if(typeof value==='boolean')return message(field==='share'?(value?'included':'private'):(value?'yes':'no'));
  if(typeof value==='string'){
   const notebook=field==='notebookId'?book.notebooks.find(item=>item.id===value):null;
   return notebook?((book.projects.find(item=>item.id===notebook.projectId)?.title??'')+' / '+notebook.title):value||message('empty');
  }
  if(Array.isArray(value)){
   if(!value.length)return message('empty');
   stack.push({kind:'children',value,field,index:0,separator:'\n'});
  }else stack.push({kind:'children',value,keys:Object.keys(value).filter(key=>!['id','createdAt','updatedAt'].includes(key)),index:0,separator:'\n'});
 }
 return null;
}

function window(cursor,book,message,size){
 const state={...cursor,stack:cursor.stack.map(frame=>({...frame}))},parts=[];let length=0;
 function advance(){
  while(state.part===null||state.offset===state.part.length){
   state.part=nextPart(state.stack,book,message);state.offset=0;if(state.part===null)return false;
  }
  return true;
 }
 while(length<size&&advance()){
  let end=Math.min(state.offset+size-length,state.part.length);
  // Never show half of a Unicode surrogate pair on either page.
  if(end<state.part.length&&state.part.charCodeAt(end-1)>=0xd800&&state.part.charCodeAt(end-1)<=0xdbff&&state.part.charCodeAt(end)>=0xdc00&&state.part.charCodeAt(end)<=0xdfff)end++;
  parts.push(state.part.slice(state.offset,end));length+=end-state.offset;state.offset=end;
 }
 return {text:parts.join(''),next:advance()?state:null};
}

export function recoveryValuePager(value,book,{message=recordRecoveryMessage,field=null,size=8192}={}){
 if(!Number.isSafeInteger(size)||size<2)throw new TypeError('Invalid recovery window.');
 let cursor={stack:[{kind:'value',value,field}],part:null,offset:0},current=null;const previous=[];
 const page=()=>{current??=window(cursor,book,message,size);return {text:current.text,number:previous.length+1,previous:previous.length>0,next:current.next!==null};};
 return {page,next(){page();if(current.next){previous.push(cursor);cursor=current.next;current=null;}return page();},previous(){if(previous.length){cursor=previous.pop();current=null;}return page();}};
}

// Compatibility descriptions are explicitly complete. The conflict review UI
// uses recoveryValuePager so only its current text window is materialized.
export function describeRecoveryValue(value,book,options={}){
 const pager=recoveryValuePager(value,book,options),parts=[];let page=pager.page();
 for(;;){parts.push(page.text);if(!page.next)return parts.join('');page=pager.next();}
}
