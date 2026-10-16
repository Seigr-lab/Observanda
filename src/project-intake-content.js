// Prepared intake files retain their identity when their project adopts them.
import path from 'node:path';
import {FileContent} from './file-content.js';
import {OwnedFileContent} from './owned-file-content.js';
import {evidenceFileStamp} from './project-evidence-file-stamp.js';
import {retiredMetadataSourceLocation,retainedMetadataValue} from './project-retired-metadata.js';
import {adoptedMetadataFact,exclusiveMetadataFact} from './project-metadata-ownership.js';
import {withRetiredProjectCatalogue} from './project-retired-records.js';
import {projectIntakeOriginKey} from './project-intake-origin.js';
import {validateIntake,intakeHash} from './intake/contract.js';
import {researchId} from './web/research-reference.js';
import {digest,serialize} from './storage.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value)),damaged=()=>{throw new AppError('MATERIAL_MISSING');};
export const intakeMetadataKey=id=>{if(!researchId(id))damaged();return 'metadata:.observanda/intake/proposals/'+id+'.json';};
export function preparedIntakeFiles(proposal){
 if(proposal?.version!==1||!researchId(proposal.id)||proposal.id!==proposal.manifest?.id||proposal.pin!==intakeHash(proposal.manifest)||!Array.isArray(proposal.prepared))damaged();
 validateIntake(proposal.manifest);const declared=new Map(proposal.manifest.files.map(file=>[file.id,file])),seen=new Set();
 return proposal.prepared.map(prepared=>{const file=declared.get(prepared?.id);if(!file||seen.has(prepared.id)||!researchId(prepared.storageId)||file.size!==prepared.size||file.sha256!==prepared.sha256)damaged();seen.add(prepared.id);return {relative:'.observanda/materials/originals/'+prepared.id+'/'+prepared.storageId+'.original',size:prepared.size,sha256:prepared.sha256};});
}
export function preparedIntakeFile(proposal,prepared){const files=preparedIntakeFiles(proposal),index=proposal.prepared.findIndex(item=>hash(item)===hash(prepared));if(index<0)damaged();return files[index];}
export async function retainedIntakeProposal(store,owner,key,revision){
 const fact=await adoptedMetadataFact(store,owner,key);if(!exclusiveMetadataFact(fact,owner.projectId)||fact.sourceRevision!==revision)damaged();const value=await retainedMetadataValue(store,revision);if(typeof value.text!=='string'||Buffer.byteLength(value.text)>8*1024*1024)damaged();let proposal;try{proposal=JSON.parse(value.text);}catch{damaged();}
 if(proposal.version!==1||intakeMetadataKey(proposal.id)!==key||!Array.isArray(proposal.prepared))damaged();validateIntake(proposal.manifest);if(proposal.id!==proposal.manifest.id||proposal.pin!==intakeHash(proposal.manifest)||proposal.manifest.workspaceId!==owner.sourceNamespace)damaged();
 const proof=await store.object(projectIntakeOriginKey(proposal.id));if(proof?.version!==1||proof.id!==proposal.id||proof.recordId!==proposal.manifest.recordId||proof.projectId!==owner.projectId||proof.sourceNamespace!==owner.sourceNamespace||proof.namespaceId!==owner.namespaceId||proof.pin!==proposal.pin)damaged();return proposal;
}
export async function intakePreparedContent(workspace,proposal,prepared){
 const file=preparedIntakeFile(proposal,prepared),absolute=path.join(workspace.root,...file.relative.split('/'));
 const location=!workspace.projectId&&await workspace.storageKind()==='catalogue'?await workspace.catalogue(store=>retiredMetadataSourceLocation(store,intakeMetadataKey(proposal.id))):null;
 if(!location){await evidenceFileStamp(workspace.root,file.relative);return new FileContent(workspace,absolute,file.size,file.sha256);}
 return new OwnedFileContent(workspace,absolute,file.size,file.sha256,consume=>workspace.catalogue(store=>withRetiredProjectCatalogue(store,location.owner,{kind:'record',id:proposal.manifest.recordId,domain:'research'},async selected=>{
  const archived=await retainedIntakeProposal(selected,location.owner,location.id,location.revision);if(hash(archived)!==hash(proposal)||hash(preparedIntakeFile(archived,prepared))!==hash(file))damaged();await evidenceFileStamp(selected.workspace.root,file.relative);return consume(new FileContent(selected.workspace,path.join(selected.workspace.root,...file.relative.split('/')),file.size,file.sha256));
 })));
}
