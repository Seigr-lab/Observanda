import {AppError} from '../errors.js';
import {exact,text} from '../modules/validation.js';
import {researchId} from '../web/research-reference.js';
import {revisionText,revisionId} from '../web/revision-model.js';
import {validMaterialReference,materialReference} from '../web/material-reference.js';

export const adapterTool='Observanda file intake adapter';
export const isIntakeAdapter=doc=>doc?.kind==='analysis'&&doc.content?.tool===adapterTool&&doc.content.version==='1';
const invalid=()=>{throw new AppError('INTAKE_INVALID');};
export function validAdapterSettings(settings){
 return exact(settings,['purpose','method','tool','toolVersion','extensions'])&&
  ['preparation','evidence','analysis','amendment'].includes(settings.purpose)&&text(settings.method,3000)&&text(settings.tool,200)&&
  text(settings.toolVersion,200)&&Array.isArray(settings.extensions)&&settings.extensions.length<=1000&&
  settings.extensions.every((item,index)=>typeof item==='string'&&item.length<=40&&/^\.[\p{L}\p{N}_-]+$/u.test(item)&&item===item.toLowerCase()&&(!index||item>settings.extensions[index-1]));
}
export async function loadAdapter(materials,ref,grants){
 if(!validMaterialReference(ref)||ref.kind!=='analysis')invalid();
 await grants.check(ref);
 const doc=await materials.read(ref);await materials.assertOwner(doc.recordId);
 const {inputsIndex,outputsIndex,parameters}=doc.content;
 if(!isIntakeAdapter(doc)||inputsIndex?.kind!=='references'||![1,2].includes(inputsIndex.count)||outputsIndex?.kind!=='references'||outputsIndex.count!==0)invalid();
 let settings;try{settings=JSON.parse(parameters);}catch{invalid();}
 if(!validAdapterSettings(settings))invalid();
 const [record,profile]=(await materials.sequences.page(inputsIndex,{limit:2})).items;
 if(record.kind!=='record'||record.id!==doc.recordId)invalid();
 await grants.check(record);
 let profileTitle=null;
 if(profile){const {readDatasetProfile}=await import('../dataset-interpretation-profile.js');profileTitle=(await readDatasetProfile(materials,profile,grants)).doc.title;}
 return {title:doc.title,settings,profile:profile??null,profileTitle,ref:materialReference(ref)};
}
export async function intakeAdapterRequest(service,action,command,options){
 const {withProfileAccess}=await import('../dataset-profile-requests.js');
 const {profileList,readDatasetProfile}=await import('../dataset-interpretation-profile.js');
 const {workspaceId,recordId}=command,materials=service.materials,saving=action==='builder-adapter-save';
 await service.bind(command,{checkRevision:false});
 return withProfileAccess(materials,{...options,recordId,write:saving},async grants=>{
  if(action==='builder-profiles'||action==='builder-adapters'){
   if(!exact(command,['workspaceId','recordId','query','after']))invalid();
   return profileList(materials,command,grants,action==='builder-adapters'?'intake-adapters':'interpretation-profiles');
  }
  if(action==='builder-adapter-read'){
   if(!exact(command,['workspaceId','recordId','ref']))invalid();
   return loadAdapter(materials,command.ref,grants);
  }
  if(!saving||!exact(command,['workspaceId','recordId','id','title','expectedRevision','settings','profile'])||
   !researchId(command.id)||!text(command.title,300,true)||!revisionId(command.expectedRevision)||!validAdapterSettings(command.settings))invalid();
  if(command.profile!==null)await readDatasetProfile(materials,command.profile,grants);
  return materials.workspace.withLock(async()=>{
   await grants.verify();await service.bind(command);
   const existing=await materials.current(command.id);
   const parameters=revisionText(command.settings);
   if(existing){
    const prior=await loadAdapter(materials,existing,grants);
    if(existing.recordId!==recordId||prior.title!==command.title||revisionText(prior.settings)!==parameters||
     revisionText(prior.profile)!==revisionText(command.profile))throw new AppError('MATERIAL_CHANGED');
    return {ref:prior.ref};
   }
   const record=await materials.retainCurrentRecordLocked(recordId);
   if(record.revision!==command.expectedRevision||record.workspaceId&&record.workspaceId!==workspaceId)throw new AppError('RECORD_CHANGED');
   const inputs=[record];if(command.profile)inputs.push(materialReference(command.profile));
   return {ref:await materials.analysisLocked({id:command.id,expectedRevision:null,recordId,title:command.title,
    tool:adapterTool,version:'1',parameters,inputs,outputs:[]})};
  });
 });
}
