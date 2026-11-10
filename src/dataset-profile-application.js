import {AppError} from './errors.js';
import {exact,text} from './modules/validation.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {materialReference,validMaterialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {readDatasetProfile} from './dataset-interpretation-profile.js';
import {withProfileSource,profileReviewReceipt,expectedSourceValue} from './dataset-profile-review.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};

export async function validateProfileApplication(materials,command){
 if(!exact(command,['id','recordId','expectedRevision','title','artifact','sourceMapping','interpretationProfile'])||
  !researchId(command.id)||!researchId(command.recordId)||command.expectedRevision!==null||!text(command.title,300,true)||
  !validMaterialReference(command.artifact)||command.artifact.kind!=='artifact'||
  !exact(command.sourceMapping,['format'])||command.sourceMapping.format!=='interpretation-profile'||
  !exact(command.interpretationProfile,['ref','review'])||!validMaterialReference(command.interpretationProfile.ref)||
  command.interpretationProfile.ref.kind!=='analysis'||!revisionId(command.interpretationProfile.review))invalid();
 await materials.assertOwner(command.recordId,{write:true});
 if(await materials.current(command.id,{includeStaged:true}))throw new AppError('MATERIAL_CHANGED');
}

export async function prepareProfileApplication(materials,command,{signal,progress,writePage,grants}={}){
 await validateProfileApplication(materials,command);
 const {interpretationProfile,artifact}=command,options={signal,...grants};
 const profile=await readDatasetProfile(materials,interpretationProfile.ref,options);
 return withProfileSource(materials,profile,artifact,options,async({header,rows,matches,failures,evidence,rule})=>{
  if(failures||profileReviewReceipt(profile.ref,artifact,matches.sourceSignature)!==interpretationProfile.review)throw new AppError('MATERIAL_CHANGED');
  async function* interpreted(){
   yield {columnCount:matches.sourceCount,sourceMapping:header.sourceMapping,retained:true,columns:async function*(){
    for(let i=0;i<matches.sourceCount;i++)yield (await rule(i)).column;
   }};
   let count=0;
   for await(const row of rows){
    if(count++%64===0)await grants?.verify?.();
    yield {...row,cells:async function*(){
     let index=0;
     for await(const cell of row.cells()){
      if(await expectedSourceValue(cell,await rule(index++)))invalid();
      yield cell;
     }
    }};
   }
  }
  const result=await materials.prepareDatasetRows(command,{source:{doc:evidence.doc},rows:interpreted(),signal,progress,writePage,
   inputReferences:[materialReference(artifact),profile.ref]});
  await grants?.verify?.();return result;
 });
}

// The worker reopens exactly the source routes authorized when the user
// requested this operation. Workers recovering after a service restart must
// obtain a fresh user authorization through Retry.
export async function profileJobAdmission(materials,command,{sourceAccess,signal,check=async()=>{}}={}){
 await check();await validateProfileApplication(materials,command);
 if(typeof sourceAccess!=='function')throw new AppError('ACCESS_LOCKED');
 const workspace=materials.workspace,workspaceId=(await workspace.outline()).metadata.id;
 const access=await sourceAccess(workspace,{signal});
 const scoped=async ref=>await materials.externalReference(ref)??materialReference({...ref,workspaceId:ref.workspaceId??workspaceId});
 const selected=async ref=>{
  const address=await scoped(ref);
  await access.use(address,async(storage,actual)=>{
   if(actual.kind!==ref.kind||actual.id!==ref.id||actual.revision!==ref.revision)throw new AppError('WORKSPACE_CHANGED');
   const {ResearchMaterials}=await import('./research-materials.js');
   await new ResearchMaterials(storage).checkReference(actual,{signal});
  });
 };
 try{
  const profile=await readDatasetProfile(materials,command.interpretationProfile.ref,{signal,check:selected});
  await selected(command.artifact);await access.verify();
  const required=[profile.ref,profile.template,profile.source.original,command.artifact];
  if(profile.ruleFile)required.push(profile.ruleFile);
  const refs=await Promise.all(required.map(scoped));
  const routes=await access.captureRoutes(refs);
  return {workspaceId,verify:async()=>{await check();await access.verify();},
   validateOutput:()=>validateProfileApplication(materials,command),close:()=>access.close(),
   open:async(storage,options)=>{
    await check();await access.verifyGrants();
    const worker=await sourceAccess(storage,options);
    try{await worker.assertRoutes(routes);await worker.verify();return worker;}catch(error){await worker.close();throw error;}
   }};
 }catch(error){await access.close();throw error;}
}

export async function retryProfileApplication(materials,service,job,{sourceAccess,signal}){
 if(!['failed','cancelled'].includes(job.state))throw new AppError('JOB_CHANGED');
 const admission=await profileJobAdmission(materials,job.input.command,{sourceAccess,signal,check:()=>service.queue.check?.()});let rollback;
 try{return await service.queue.transaction(async()=>{
  const current=await service.queue.read(job.id);
  if(!current||revisionText(current.input)!==revisionText(job.input)||!['failed','cancelled'].includes(current.state))throw new AppError('JOB_CHANGED');
  await admission.verify();await admission.validateOutput();
  if(!service.comparisonAccess)throw new AppError('ACCESS_LOCKED');
  rollback=service.comparisonAccess.bind(admission.workspaceId,job.id,job.input.command,admission.open);
  return service.queue.controlLocked(job.id,'retry');
 });}catch(error){rollback?.();throw error;}finally{await admission.close();}
}
