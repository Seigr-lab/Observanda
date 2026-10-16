import {RecordTypeIndex} from './record-type-index.js';
import {AppError} from './errors.js';
import {validViewFilter} from './web/record-view-model.js';
import {RECORD_TYPES} from './web/record-types.js';
import {compareTitles,compareKey} from './web/query-order.js';
const order=(a,b)=>compareTitles(a.label,b.label)||compareKey(a.value,b.value);
const validChoice=value=>value&&validViewFilter(value.value)&&value.value!=='all'&&typeof value.label==='string'&&value.label.length<=160;
// Shared bounded discovery; each caller validates and pins its own scope.
export async function recordTypePage(store,snapshot,{workspaceId,etag,ids,selectedValue,search,limit,cursor,signature,namespace,signal}){
 let anchor={signature,after:null,backward:false};
 if(cursor){try{anchor=store.decode(namespace,workspaceId,Buffer.from(cursor,'base64url'));}catch(error){if(error.code==='ACCESS_LOCKED')throw error;throw new AppError('RECORD_QUERY_CURSOR');}}
 if(anchor?.signature!==signature||typeof anchor.backward!=='boolean'||anchor.after!==null&&!validChoice(anchor.after)||anchor.backward&&anchor.after===null)throw new AppError('RECORD_QUERY_CURSOR');
 const types=new RecordTypeIndex(store),needle=search.trim().toLocaleLowerCase('en'),items=[];
 let total=0,before=0,selected=null;
 async function* choices(){
  for(const type of RECORD_TYPES)yield {value:type.id,label:type.label};
  for await(const type of types.types(snapshot,ids,{signal}))yield {value:'template:'+type.id,label:type.label};
 }
 for await(const choice of choices()){
  signal?.throwIfAborted();if(choice.value===selectedValue)selected=choice;
  if(!choice.label.toLocaleLowerCase('en').includes(needle))continue;
  total++;const relation=anchor.after?order(choice,anchor.after):1;
  if(anchor.after&&(anchor.backward?relation<0:relation<=0))before++;
  if(anchor.after&&(anchor.backward?relation>=0:relation<=0))continue;
  let low=0,high=items.length;
  while(low<high){const middle=(low+high)>>1;if(order(items[middle],choice)*(anchor.backward?-1:1)<0)low=middle+1;else high=middle;}
  if(low<limit){items.splice(low,0,choice);if(items.length>limit)items.pop();}
 }
 if(anchor.backward)items.reverse();
 const offset=anchor.backward?before-items.length:before;
 const encode=(after,backward)=>store.encode(namespace,workspaceId,{signature,after,backward}).toString('base64url');
 signal?.throwIfAborted();
 return {workspaceId,etag,items,total,offset,selected,
  previousCursor:offset>0&&items.length?encode(items[0],true):null,
  nextCursor:offset+items.length<total&&items.length?encode(items.at(-1),false):null};
}
