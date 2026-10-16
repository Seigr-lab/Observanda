import {researchContext,researchOwner} from './project-context.js';
import {researchId} from './research-reference.js';
import {FEATURE_MODULES} from './feature-modules.js';
import {validModuleReference,validReferenceOwner,referenceKey} from './modules/reference-client.js';

const researchTypes=new Set(['project','notebook','record']);
const invalid=()=>{throw {code:'INVALID'};};
export const availableOwnedModule=(id,modules=FEATURE_MODULES)=>modules.some(module=>module.id===id&&typeof module.createUI==='function');
// The destination is derived from the authenticated summary and registered
// module capabilities, without loading another owner's editable entity.
export function moduleReferenceDestination(result,target,workspaceId,modules=FEATURE_MODULES){
 if(!validModuleReference(target)||result?.workspaceId!==workspaceId||!validModuleReference(result.reference)||referenceKey(result.reference)!==referenceKey(target)||!validReferenceOwner(result.owner)||result.type!==target.type||result.id!==target.id||typeof result.title!=='string'||!researchId(result.openId))invalid();
 if(researchTypes.has(target.type)){
  if(result.openType!==target.type||result.openId!==target.id)invalid();
  return {research:{workspaceId:result.owner.workspaceId,kind:result.openType,id:result.openId}};
 }
 if(result.owner.workspaceId!==target.workspaceId)invalid();
 const module=modules.find(value=>value.entityTypes?.includes(result.openType)&&!value.ownsEntity&&typeof value.createUI==='function');
 if(!module)invalid();
 return {module:{workspaceId:result.owner.workspaceId,projectId:result.owner.projectId??'',labBookId:result.owner.labBookId??'',moduleId:module.id,modulePath:result.openType+'/'+result.openId}};
}
export function moduleReferenceNavigation({state,api,access=operation=>operation(),captureReturn=async()=>null,openResearch,openModule}){
 let generation=0;
 const context=()=>JSON.stringify([researchContext(state),state.book?.id,state.page,state.moduleId,state.modulePath,state.selected]);
 return async target=>{
  if(!validModuleReference(target))invalid();
  const request=++generation,stamp=context(),workspaceId=state.book.id,owner=structuredClone(researchOwner(state));
  const check=()=>{if(request!==generation||stamp!==context()||state.access?.locked)throw new DOMException('Reference navigation changed','AbortError');};
  let result;
  try{result=await access(()=>{check();return api('/api/modules/references/resolve',{workspaceId,target},{owner,adopt:false});});}
  catch(error){check();throw error;}
  check();const destination=moduleReferenceDestination(result,target,workspaceId);
  const origin=await captureReturn();check();
  if(destination.research)return openResearch(destination.research,origin);
  return openModule(destination.module);
 };
}
