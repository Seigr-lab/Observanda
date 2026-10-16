import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {ResearchMaterials} from './research-materials.js';
import {publicationDependencyState} from './publication-analysis-inputs.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
export function publicationAnalysisGroups(groups,identities){
 return {fingerprint:digest(JSON.stringify(groups.map(group=>[group.workspaceId,group.analysis.fingerprint]))),
  items:groups.flatMap(group=>group.analysis.items.map(item=>({...item,id:digest(group.workspaceId+'/'+item.id),sourceWorkspaceId:group.workspaceId,recordId:identities.identity(group.workspaceId,'record',item.recordId)})))};
}
// Current-source checks use the same authenticated namespace resolver as
// selection. An unavailable owner cannot silently be checked against the host.
export async function publicationAnalysisState(workspace,candidate,{sourceReader,signal,requireCurrent=true}={}){
 if(!candidate.sourceGroups)return {analysis:await publicationDependencyState(new ResearchMaterials(workspace),candidate.sourceMaterials??[],{sourceReader,workspaceId:candidate.workspaceId,signal})};
 const groups=candidate.sourceGroups,snapshots=candidate.sourceSnapshots,namespace=candidate.workspaceId;
 if(!researchId(namespace)||!Array.isArray(groups)||!groups.length||groups.length>101||groups[0]?.workspaceId!==namespace||new Set(groups.map(group=>group?.workspaceId)).size!==groups.length||groups.some(group=>!researchId(group?.workspaceId)||!Array.isArray(group.materials))||!Array.isArray(snapshots)||snapshots.length!==groups.length-1||new Set(snapshots.map(row=>row?.workspaceId)).size!==snapshots.length||snapshots.some(row=>!researchId(row?.workspaceId)||!revisionId(row?.snapshotId)||!groups.slice(1).some(group=>group.workspaceId===row.workspaceId)))throw new AppError('JOB_DAMAGED');
 if(typeof sourceReader!=='function')throw new AppError('ACCESS_LOCKED');
 const reader=await sourceReader({signal}),current=[],currentSnapshots=[];
 try{
  for(const group of groups){
   signal?.throwIfAborted();
   if(group.workspaceId===namespace){current.push({...group,analysis:await publicationDependencyState(new ResearchMaterials(workspace),group.materials,{sourceReader,workspaceId:namespace,signal})});continue;}
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
