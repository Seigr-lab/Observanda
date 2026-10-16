import {projectSourceOwnerOrderChanges} from './project-source-owner-order.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {projectSourceDeclaredOwner} from './project-source-declared-owner.js';
import {serialize} from './storage-format.js';
export const projectFontLibraryKey='metadata:.observanda/fonts/library.json';
export async function projectFontLibrarySelection(store,inventory,{signal}={}){
 return store.workspace.inspectCatalogue(store,async()=>{
  const owner=projectSourceDeclaredOwner(store,inventory.namespaceId,{signal}),items=[];
  for(const item of await new WorkspaceFonts(store.workspace).list()){signal?.throwIfAborted();const fact=await owner('font',item.id);if(fact.kind==='project'&&fact.projectId===inventory.projectId)items.push(item);}
  return items;
 });
}
export function projectSourceFontOwner(store,inventory,{signal}={}){
 const fonts=new WorkspaceFonts(store.workspace),declared=projectSourceDeclaredOwner(store,inventory.namespaceId,{signal});
 return async id=>{
  const match=/^metadata:\.observanda\/fonts\/(custom-[a-f0-9]{64})\.json$/.exec(id);if(!match)return null;
  return store.workspace.inspectCatalogue(store,async()=>{signal?.throwIfAborted();const font=await fonts.get(match[1]);try{return await declared('font',match[1]);}finally{font.bytes.fill(0);}});
 };
}
// The legacy font library is capped at 64 entries. Compare its entries and
// selected relative order, so changing one foreign font does not claim every
// project represented in this shared index. Font bodies are not read here.
export async function* projectSourceFontLibraryChanges(before,after,inventory,{signal}={}){
 async function read(store){
  return store.workspace.inspectCatalogue(store,async()=>{const entries=await new WorkspaceFonts(store.workspace).list(),owner=projectSourceDeclaredOwner(store,inventory.namespaceId,{signal}),items=new Map(),selected=[];
   for(const value of entries){signal?.throwIfAborted();const fact=await owner('font',value.id);items.set(value.id,{value,owner:fact});if(fact.kind==='project'&&fact.projectId===inventory.projectId)selected.push(value.id);}
   return {items,selected};
  });
 }
 const prior=await read(before),current=await read(after);
 for(const id of new Set([...prior.items.keys(),...current.items.keys()])){signal?.throwIfAborted();const a=prior.items.get(id),b=current.items.get(id);if(serialize(a?.value??null)!==serialize(b?.value??null)){if(a)yield a.owner;if(b)yield b.owner;}}
 if(inventory.projectId===null)yield* projectSourceOwnerOrderChanges([...prior.items].map(([id,{owner}])=>({id,owner})),[...current.items].map(([id,{owner}])=>({id,owner})));
 else if(serialize(prior.selected)!==serialize(current.selected))yield {kind:'project',projectId:inventory.projectId};
}
