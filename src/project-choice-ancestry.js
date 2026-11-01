import {AppError} from './errors.js';
// Request-local parent facts are bounded. Brent's cycle check keeps traversal
// memory independent of hierarchy depth; no authorization survives the view.
export function projectChoiceAncestry(view,{signal,check=()=>{}}={}){
 const facts=new Map(),legacy=new Map((view.legacy??[]).map(entry=>[entry.projectId,entry]));
 const get=async id=>{check();signal?.throwIfAborted();if(facts.has(id)){const value=facts.get(id);facts.delete(id);facts.set(id,value);return value;}
  const row=await view.get(id);if(row&&row.state!=='active')throw new AppError('FORMAT');const entry=row?.entry??legacy.get(id);if(!entry)throw new AppError('NOT_FOUND');facts.set(id,entry);if(facts.size>256)facts.delete(facts.keys().next().value);return entry;
 };
 return async function* ancestors(entry){let checkpoint=entry.projectId,power=1,length=0;
  while(entry){check();signal?.throwIfAborted();yield entry;if(entry.parentId===null)return;entry=await get(entry.parentId);if(entry.projectId===checkpoint)throw new AppError('FORMAT');if(++length===power){checkpoint=entry.projectId;power*=2;length=0;}}
 };
}
