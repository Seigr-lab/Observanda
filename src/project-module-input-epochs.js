// Earlier imported command origins remain exact when a staged module history
// advances. Each accepted epoch is bound to this conversion and project owner.
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
const key=head=>'project:module-input:'+head;
const identity=['projectId','namespaceId','sourceNamespace'];
export async function projectModuleInputEpochMatches(store,origin,migration){
 if(!origin||!migration||!identity.every(field=>researchId(origin[field])&&origin[field]===migration[field])||origin.projectId!==store.workspace.projectId||!revisionId(origin.moduleHead)||!revisionId(migration.moduleHead))return false;
 if(origin.moduleHead===migration.moduleHead)return true;
 const saved=await store.object(key(origin.moduleHead));
 return !!saved&&Object.keys(saved).sort().join()==='moduleHead,namespaceId,operationId,projectId,sourceNamespace,sourceRevision,version'&&saved.version===1&&researchId(saved.operationId)&&identity.every(field=>saved[field]===origin[field])&&saved.moduleHead===origin.moduleHead&&Number.isSafeInteger(saved.sourceRevision)&&saved.sourceRevision>=0&&Number.isSafeInteger(origin.sourceOrdinal)&&origin.sourceOrdinal>0&&origin.sourceOrdinal<=saved.sourceRevision&&Number.isSafeInteger(migration.sourceRevision)&&saved.sourceRevision<=migration.sourceRevision;
}
