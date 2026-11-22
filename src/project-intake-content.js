// Prepared intake files are read from their exact stored originals.
import path from 'node:path';
import {FileContent} from './file-content.js';
import {evidenceFileStamp} from './project-evidence-file-stamp.js';
import {validateIntake,intakeHash} from './intake/contract.js';
import {researchId} from './web/research-reference.js';
import {digest,serialize} from './storage.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value)),damaged=()=>{throw new AppError('MATERIAL_MISSING');};
export function preparedIntakeFiles(proposal){
 if(proposal?.version!==1||!researchId(proposal.id)||proposal.id!==proposal.manifest?.id||proposal.pin!==intakeHash(proposal.manifest)||!Array.isArray(proposal.prepared))damaged();
 validateIntake(proposal.manifest);const declared=new Map(proposal.manifest.files.map(file=>[file.id,file])),seen=new Set();
 return proposal.prepared.map(prepared=>{const file=declared.get(prepared?.id);if(!file||seen.has(prepared.id)||!researchId(prepared.storageId)||file.size!==prepared.size||file.sha256!==prepared.sha256)damaged();seen.add(prepared.id);return {relative:'.observanda/materials/originals/'+prepared.id+'/'+prepared.storageId+'.original',size:prepared.size,sha256:prepared.sha256};});
}
export function preparedIntakeFile(proposal,prepared){const files=preparedIntakeFiles(proposal),index=proposal.prepared.findIndex(item=>hash(item)===hash(prepared));if(index<0)damaged();return files[index];}
export async function intakePreparedContent(workspace,proposal,prepared){
 const file=preparedIntakeFile(proposal,prepared),absolute=path.join(workspace.root,...file.relative.split('/'));
 await evidenceFileStamp(workspace.root,file.relative);return new FileContent(workspace,absolute,file.size,file.sha256);
}
