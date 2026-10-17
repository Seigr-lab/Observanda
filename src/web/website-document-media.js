import {websiteMediaItem,MEDIA_WINDOW} from './website-inventory.js';
// Bounded library windows retain only displayed assets. Read caches are scoped
// to the selected document view; complete usage admission stays with its owner.
export function websiteDocumentMedia({state,documents,onChange}){
 let context=null,selections=Promise.resolve();const windows=new Map(),selected=new Map();
 const enabled=()=>Boolean(documents?.enabled());
 function clear(){for(const item of [...windows.values(),...selected.values()])item.controller?.abort();windows.clear();selected.clear();}
 function sync(){const next=enabled()?documents.viewKey():null;if(next!==context){clear();context=next;}return context;}
 const item=value=>({key:value.id,label:value.caption||value.alt||value.name||value.kind,asset:value,entryId:null});
 function window({kind='all'}={},offset=0,search=''){
  const stamp=sync(),key=JSON.stringify([kind,offset,search]);let cached=windows.get(key);
  if(!cached){
   while(windows.size>=6){const first=windows.keys().next().value;windows.get(first).controller?.abort();windows.delete(first);}
   const controller=new AbortController();cached={key,controller,pending:true,items:[],offset,total:0,previous:null,next:null};windows.set(key,cached);
   const load=async()=>{
    let result=await documents.window('assets',{offset,limit:MEDIA_WINDOW,search,kind,signal:controller.signal});
    if(result.offset>=result.total&&result.offset>0)result=await documents.window('assets',{offset:result.total?Math.floor((result.total-1)/MEDIA_WINDOW)*MEDIA_WINDOW:0,limit:MEDIA_WINDOW,search,kind,signal:controller.signal});return result;
   };
   load().then(result=>{
    if(controller.signal.aborted||context!==stamp||windows.get(key)!==cached)return;
    for(const row of result.items)documents.remember('assets',row);
    Object.assign(cached,{pending:false,items:result.items.map(row=>item(row.value)),offset:result.offset,total:result.total,previous:result.offset?Math.max(0,result.offset-MEDIA_WINDOW):null,next:result.offset+result.items.length<result.total?result.offset+MEDIA_WINDOW:null});onChange({type:'window',key});
   }).catch(error=>{if(controller.signal.aborted||context!==stamp||windows.get(key)!==cached)return;if(error.name==='AbortError'){windows.delete(key);onChange({type:'window',key});return;}cached.pending=false;cached.error=error;onChange({type:'window',key});});
  }
  return {...cached,items:cached.items.map(row=>websiteMediaItem(state.book,row.key)??row)};
 }
 function ensure(keys){
  const stamp=sync();for(const key of keys){
   if(!key||websiteMediaItem(state.book,key)||selected.has(key))continue;
   while(selected.size>=64){const first=selected.keys().next().value;selected.get(first).controller.abort();selected.delete(first);}
   const controller=new AbortController(),entry={controller};selected.set(key,entry);
   selections=selections.then(async()=>{
    if(controller.signal.aborted||context!==stamp)return;
    try{await documents.item('assets',key,{signal:controller.signal});if(!controller.signal.aborted&&context===stamp){selected.delete(key);onChange({type:'selected',key});}}
    catch(error){if(controller.signal.aborted||context!==stamp)return;if(error.name==='AbortError')selected.delete(key);else entry.error=error;onChange({type:'selected',key});}
   });
  }
 }
 function selection(key){if(!key)return {pending:false,item:null};ensure([key]);const item=websiteMediaItem(state.book,key),entry=selected.get(key);return {item,pending:!item&&Boolean(entry)&&!entry.error,...(entry?.error?{error:entry.error}:{})};}
 return {enabled,window,ensure,selection,clear,sync};
}
