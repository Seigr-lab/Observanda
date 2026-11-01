import {AppError} from './errors.js';
const empty=()=>({prefix:'',matched:false,excluded:false,present:false});
// The caller owns one encrypted scratch lifetime inside the admitted directory
// snapshot. Completed summaries and pending child links keep both the walk and
// unwind independent of hierarchy depth in memory. No ancestry survives it.
export function projectChoiceAncestry(view,work,{query='',exclude=null,normalize=value=>value,signal,check=()=>{}}={}){
 const hot=new Map(),legacy=new Map((view.legacy??[]).map(entry=>[entry.projectId,entry])),width=Math.max(0,query.length-1);
 const admit=()=>{check();signal?.throwIfAborted();};
 const remember=(id,value)=>{hot.delete(id);hot.set(id,value);if(hot.size>256)hot.delete(hot.keys().next().value);return value;};
 const get=async id=>{admit();if(hot.has(id))return remember(id,hot.get(id));const value=await work.get(id);return value?.state==='complete'?remember(id,value):value;};
 const entryFor=async id=>{admit();const row=await view.get(id);admit();if(row&&row.state!=='active')throw new AppError('FORMAT');const entry=row?.entry??legacy.get(id);if(!entry)throw new AppError('NOT_FOUND');return entry;};
 // External database services have no local disk authority. Exact traversal
 // remains bounded in memory there; no client pathname is treated as a server
 // volume, and Brent's cycle check needs no depth-sized visited set.
 if(!work)return async parentId=>{
  let id=parentId,checkpoint=id,power=1,length=0,tail='',first=true;const result=empty();
  while(id!==null){admit();let entry=hot.get(id);if(entry)remember(id,entry);else entry=remember(id,await entryFor(id));const label=normalize(entry.summary?.title??entry.projectId),part=tail+(first?'':' ')+label;
   result.matched||=!!query&&part.includes(query);result.excluded||=id===exclude;result.prefix=(result.prefix+(first?'':' ')+label).slice(0,width);result.present=true;tail=width?part.slice(-width):'';first=false;id=entry.parentId;
   if(id===checkpoint)throw new AppError('FORMAT');if(++length===power){checkpoint=id;power*=2;length=0;}
  }return result;
 };
 return async parentId=>{
  admit();if(parentId===null)return empty();let id=parentId,child=null,summary;
  for(;;){
   const saved=await get(id);if(saved?.state==='complete'){summary=saved.summary;break;}if(saved)throw new AppError('FORMAT');
   const entry=await entryFor(id);
   const label=normalize(entry.summary?.title??entry.projectId);await work.put(id,{state:'pending',child,prefix:label.slice(0,width),suffix:width?label.slice(-width):'',length:label.length,matched:!!query&&label.includes(query),excluded:id===exclude});child=id;
   if(entry.parentId===null){summary=empty();break;}id=entry.parentId;
  }
  while(child!==null){
   admit();const pending=await work.get(child);if(pending?.state!=='pending')throw new AppError('FORMAT');
   summary={prefix:(pending.prefix+(pending.length<width&&summary.present?' '+summary.prefix:'')).slice(0,width),matched:pending.matched||summary.matched||!!query&&summary.present&&(pending.suffix+' '+summary.prefix).includes(query),excluded:pending.excluded||summary.excluded,present:true};
   const complete={state:'complete',summary};await work.put(child,complete);remember(child,complete);child=pending.child;
  }
  admit();return summary;
 };
}
