import {publicationResearchWorkspace} from './publication-pin.js';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {ResearchMaterials} from './research-materials.js';
import {publicationDependencyState} from './publication-analysis-inputs.js';
import {publicationRetainedInput,nativePublicationCandidate} from './publication-retained-input.js';
import {publicationOwnerId} from './publication-owner-identities.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
export function publicationAnalysisGroups(groups,identities){
 return {fingerprint:digest(JSON.stringify(groups.map(group=>[group.workspaceId,group.analysis.fingerprint]))),
  items:groups.flatMap(group=>group.analysis.items.map(item=>({...item,id:digest(group.workspaceId+'/'+item.id),sourceWorkspaceId:group.workspaceId,recordId:identities.identity(group.workspaceId,'record',item.recordId)})))};
}
// Current-source checks use the same authenticated namespace resolver as
// selection. An unavailable owner cannot silently be checked against the host.
export async function publicationAnalysisState(workspace,candidate,options={}){
 if(nativePublicationCandidate(candidate))return retainedAnalysisState(workspace,candidate,options);
 return legacyAnalysisState(workspace,candidate,options);
}
async function legacyAnalysisState(workspace,candidate,{sourceReader,signal,requireCurrent=true}={}){
 if(!candidate.sourceGroups)return {analysis:await publicationDependencyState(new ResearchMaterials(publicationResearchWorkspace(workspace)),candidate.sourceMaterials??[],{sourceReader,workspaceId:candidate.workspaceId,signal})};
 const groups=candidate.sourceGroups,snapshots=candidate.sourceSnapshots,namespace=candidate.workspaceId;
 if(!researchId(namespace)||!Array.isArray(groups)||!groups.length||groups.length>101||groups[0]?.workspaceId!==namespace||new Set(groups.map(group=>group?.workspaceId)).size!==groups.length||groups.some(group=>!researchId(group?.workspaceId)||!Array.isArray(group.materials))||!Array.isArray(snapshots)||snapshots.length!==groups.length-1||new Set(snapshots.map(row=>row?.workspaceId)).size!==snapshots.length||snapshots.some(row=>!researchId(row?.workspaceId)||!revisionId(row?.snapshotId)||!groups.slice(1).some(group=>group.workspaceId===row.workspaceId)))throw new AppError('JOB_DAMAGED');
 if(typeof sourceReader!=='function')throw new AppError('ACCESS_LOCKED');
 const reader=await sourceReader({signal}),current=[],currentSnapshots=[];
 try{
  for(const group of groups){
   signal?.throwIfAborted();
   if(group.workspaceId===namespace){current.push({...group,analysis:await publicationDependencyState(new ResearchMaterials(publicationResearchWorkspace(workspace)),group.materials,{sourceReader,workspaceId:namespace,signal})});continue;}
   await reader.use(group.workspaceId,undefined,async(store,snapshot,pinned)=>{
    if(requireCurrent&&snapshots.find(row=>row.workspaceId===group.workspaceId).snapshotId!==pinned.snapshotId)throw new AppError('STALE');
    const storage=new Proxy(pinned.storage,{get(target,key){if(key==='catalogue')return consume=>consume(store);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const analysis=await publicationDependencyState(new ResearchMaterials(storage),group.materials,{sourceReader,workspaceId:group.workspaceId,signal});
    current.push({...group,analysis});currentSnapshots.push({workspaceId:group.workspaceId,snapshotId:pinned.snapshotId});
   },{prepare:storage=>new ResearchMaterials(storage).index.ensure()});
  }
  await reader.verify();return {analysis:publicationAnalysisGroups(current,new PublicationOwnerIdentities(namespace)),sourceSnapshots:currentSnapshots};
 }finally{await reader.close();}
}


async function retainedAnalysisState(workspace,candidate,{sourceReader,signal,requireCurrent=true,onItem=async()=>{},onCheck}={}){
 const namespace=candidate.workspaceId;
 // The owner directory is immutable and bounded. Admit it in one snapshot,
 // then release that snapshot before checking each owner's current inputs.
 const {input,groups}=await workspace.catalogue(async()=>{
  const input=await publicationRetainedInput(workspace,candidate,{signal}),header=await input.fullHeader(),groups=[];
  if(typeof candidate.hasSources!=='boolean'||header.hasSources!==candidate.hasSources)throw new AppError('JOB_DAMAGED');
  for await(const group of input.sourceGroups()){
   if(groups.length>=101||!researchId(group?.workspaceId)||groups.some(prior=>prior.workspaceId===group.workspaceId)||!group.analysis||!revisionId(group.analysis.fingerprint)||!Number.isSafeInteger(group.analysis.count)||group.analysis.count<0||(!groups.length?group.workspaceId!==namespace||group.snapshotId!==null:!revisionId(group.snapshotId)))throw new AppError('JOB_DAMAGED');groups.push(group);
  }
  return {input,groups};
 });
 if(!groups.length||candidate.hasSources!==(groups.length>1))throw new AppError('JOB_DAMAGED');
 const expected=candidate.sourceSnapshots??groups.slice(1).map(group=>({workspaceId:group.workspaceId,snapshotId:group.snapshotId}));
 if(!Array.isArray(expected)||expected.length!==groups.length-1||expected.some((row,i)=>!researchId(row?.workspaceId)||!revisionId(row?.snapshotId)||expected.slice(0,i).some(prior=>prior.workspaceId===row.workspaceId)||!groups.slice(1).some(group=>group.workspaceId===row.workspaceId)))throw new AppError('JOB_DAMAGED');
 if(!candidate.hasSources)return {analysis:await publicationDependencyState(new ResearchMaterials(publicationResearchWorkspace(workspace)),input.sourceMaterials({workspaceId:namespace}),{sourceReader,workspaceId:namespace,signal,onItem,onCheck})};
 if(typeof sourceReader!=='function')throw new AppError('ACCESS_LOCKED');
 const reader=await sourceReader({signal}),fingerprints=[],currentSnapshots=[];let count=0;
 const analyze=async(group,materials)=>{
  const analysis=await publicationDependencyState(materials,input.sourceMaterials({workspaceId:group.workspaceId}),{sourceReader,workspaceId:group.workspaceId,signal,onCheck,onItem:async item=>{
   count++;await onItem({...item,id:digest(group.workspaceId+'/'+item.id),sourceWorkspaceId:group.workspaceId,recordId:publicationOwnerId(namespace,group.workspaceId,'record',item.recordId)});
  }});fingerprints.push([group.workspaceId,analysis.fingerprint]);
 };
 try{
  for(const group of groups){
   signal?.throwIfAborted();
   if(group.workspaceId===namespace){await analyze(group,new ResearchMaterials(publicationResearchWorkspace(workspace)));continue;}
   await reader.use(group.workspaceId,undefined,async(store,snapshot,pinned)=>{
    if(requireCurrent&&expected.find(row=>row.workspaceId===group.workspaceId).snapshotId!==pinned.snapshotId)throw new AppError('STALE');
    const storage=new Proxy(pinned.storage,{get(target,key){if(key==='catalogue')return consume=>consume(store);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    await analyze(group,new ResearchMaterials(storage));currentSnapshots.push({workspaceId:group.workspaceId,snapshotId:pinned.snapshotId});
   },{prepare:storage=>new ResearchMaterials(storage).index.ensure()});
  }
  await reader.verify();return {analysis:{fingerprint:digest(JSON.stringify(fingerprints)),count},sourceSnapshots:currentSnapshots};
 }finally{await reader.close();}
}
