import {AppError} from '../errors.js';
import {revisionText} from '../web/revision-model.js';
import {qualityAssessment,qualityDay,validResourceQuality} from '../web/modules/resource-quality.js';
import {exact,uuid,text,requireValue} from './validation.js';

export async function verifyResourceQuality(workspace,current,previous){
 if(!current)return;
 const ref=current.kind==='lot'?current.evidence:current.certificate;
 if(!ref)return;
 const prior=previous?.kind===current.kind?(current.kind==='lot'?previous.evidence:previous.certificate):null;
 if(prior&&revisionText(prior)===revisionText(ref)&&(current.kind==='lot'||revisionText(previous.coverage)===revisionText(current.coverage)))return;
 const {ResearchMaterials}=await import('../research-materials.js');
 const materials=new ResearchMaterials(workspace);
 await materials.assertReferenceWorkspace(ref);
 if(current.kind==='lot'){await materials.checkReference(ref);return;}
 const {scientificCalibrationRequest}=await import('../scientific-calibrations.js');
 const {coverage}=await scientificCalibrationRequest(materials,'calibration-inspect',{ref});
 requireValue(coverage&&revisionText(coverage)===revisionText(current.coverage),'Choose a retained calibration certificate with its exact validity dates','MODULE_REFERENCE');
}

export function observedResourceQuality(resource,workflow,instant,zone){
 const quality=resource.data.quality;
 if(!quality)return {};
 const qualityAtUse=recordedResourceQuality(resource,workflow,instant,zone);
 if(qualityAtUse.blocked){const {version,resourceRevision,quality:_,...assessment}=qualityAtUse;void version;void resourceRevision;throw new AppError('RESOURCE_QUALITY_BLOCK',[{...assessment,reason:quality.holdReason}]);}
 return {qualityAtUse};
}

// The readiness of something that already happened is recorded as it was,
// including a block; callers that start new work use observedResourceQuality.
export function recordedResourceQuality(resource,workflow,instant,zone){
 const quality=resource.data.quality;
 return {version:1,resourceId:resource.id,resourceRevision:resource.revision,name:resource.data.name,quality,...qualityAssessment(quality,workflow,qualityDay(instant,zone))};
}

export function validObservedQuality(snapshot,resourceId,{blocked=false}={}){
 if(!exact(snapshot,['version','resourceId','resourceRevision','name','quality','workflow','on','policy','issues','blocked'])||
  snapshot.version!==1||!uuid(snapshot.resourceId)||snapshot.resourceId!==resourceId||!Number.isSafeInteger(snapshot.resourceRevision)||
  snapshot.resourceRevision<1||!text(snapshot.name,240,true)||!validResourceQuality(snapshot.quality,snapshot.quality?.kind==='lot'?'material':'equipment'))return false;
 try{
  const expected=qualityAssessment(snapshot.quality,snapshot.workflow,snapshot.on);
  return (blocked||!expected.blocked)&&snapshot.policy===expected.policy&&snapshot.blocked===expected.blocked&&revisionText(snapshot.issues)===revisionText(expected.issues);
 }catch{return false;}
}
