// Authenticate retained domain provenance without loading conversion writers.
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest} from './storage-format.js';
const key=(phase,head)=>'project:domain-transfer-input:'+phase+':'+head;
const validPhase=phase=>typeof phase==='string'&&/^[a-z][a-z-]{0,47}$/.test(phase)&&!['research','ownership','verification'].includes(phase);
export async function projectDomainSourceMatches(store,phase,origin,research){
 if(!validPhase(phase)||origin?.version!==1||research?.version!==1||origin.projectId!==store.workspace.projectId||origin.projectId!==research.projectId||origin.namespaceId!==research.namespaceId||origin.sourceNamespace!==research.sourceNamespace||!revisionId(origin.sourceHead))return false;
 if(origin.sourceHead===research.sourceHead)return true;
 const value=await store.object(key(phase,origin.sourceHead));
 if(!value||Object.keys(value).sort().join()!=='inputRevision,namespaceId,operationId,phase,projectId,sourceHead,sourceNamespace,version'||value.version!==1||value.phase!==phase||!researchId(value.operationId)||!revisionId(value.inputRevision)||!['projectId','namespaceId','sourceNamespace','sourceHead'].every(field=>value[field]===origin[field]))return false;
 const snapshot=await store.object('project:snapshot:'+origin.sourceHead);
 return snapshot?.version===1&&snapshot.projectId===origin.projectId&&snapshot.namespaceId===origin.namespaceId&&snapshot.sourceNamespace===origin.sourceNamespace&&snapshot.sourceId===origin.sourceHead&&snapshot.snapshotId===digest('Observanda/project-history/v1/'+origin.sourceNamespace+'/'+origin.namespaceId+'/'+origin.sourceHead);
}
