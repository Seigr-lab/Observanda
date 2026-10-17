import {inheritMaterialNamespace} from './material-reference-requests.js';
import {validMaterialReference} from './material-reference.js';
// Resolve only the links on this displayed page. Canonical documents and their
// hashes stay untouched, and resolving a name grants no foreign read authority.
export async function materialReferenceElements(root,workspaceId,{resolve}={}){
 if(!workspaceId)return;
 const controls=[];
 for(const control of root.querySelectorAll('[data-action="material-reference"][data-ref]')){
  const ref=JSON.parse(control.dataset.ref);controls.push({control,ref,set:value=>control.dataset.ref=JSON.stringify(value)});
 }
 for(const control of root.querySelectorAll('[data-action="material-measurement-inspect"][data-source]')){
  const source=JSON.parse(control.dataset.source);controls.push({control,ref:source.ref,set:value=>control.dataset.source=JSON.stringify({...source,ref:value})});
 }
 const pending=[];
 for(const item of controls){
  if(resolve&&item.ref.workspaceId===undefined){item.disabled=item.control.disabled;item.control.disabled=true;pending.push(item);}
  else item.set(inheritMaterialNamespace(item.ref,workspaceId));
 }
 for(let offset=0;offset<pending.length;offset+=32){
  const page=pending.slice(offset,offset+32),result=await resolve(page.map(item=>item.ref));
  if(!Array.isArray(result?.items)||result.items.length!==page.length)throw new Error('Invalid retained reference response');
  for(const [index,item] of page.entries()){
   const value=result.items[index];if(!validMaterialReference(value)||['kind','id','revision'].some(key=>value[key]!==item.ref[key]))throw new Error('Invalid retained reference response');
   item.set(inheritMaterialNamespace(value,workspaceId));item.control.disabled=item.disabled;
  }
 }
}
