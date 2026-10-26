// The same domain ownership contract selects transferred jobs and classifies
// current source changes. Queue position, lease state and links are not owners.
import {LocalIntake} from './intake/service.js';
import {ResearchMaterials} from './research-materials.js';
import {MediaImports} from './media-imports.js';
import {researchId} from './web/research-reference.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
export const projectCommandJobs=new Set(['analysis.compare','figure.calculate','dataset.prepare']);
export const projectPublicationJobs=new Set(['publication.prepare','publication.analysis-review','publication.deploy','publication.repository','publication.verify']);
const commands=projectCommandJobs,publications=projectPublicationJobs;
const damaged=()=>{throw new AppError('JOB_DAMAGED');},ownership=()=>{throw new AppError('PROJECT_MIGRATION_OWNERSHIP');},fingerprint=value=>digest(serialize(value));
export function projectJobOwner(workspace,inventory){
 const materials=new ResearchMaterials(workspace);
  async function record(id){if(!researchId(id))damaged();const owner=await inventory.record(id);if(!owner)ownership();return owner;}
  return async function owner(job){
   if(commands.has(job.type)){if(job.input.command?.recordId!==job.scope)damaged();return record(job.scope);}
   if(job.type==='evidence.finalize'){
    const session=await materials.importState(job.input.importId);
    if(session.id!==job.id||session.recordId!==job.scope||session.batchId||session.size!==job.input.size)damaged();return record(job.scope);
   }
   if(job.type==='evidence.batch'){
    const batch=await materials.intakes.read(job.id);if(batch.command.recordId!==job.scope)damaged();return record(job.scope);
   }
   if(['intake.stage','intake.apply'].includes(job.type)){const proposal=await new LocalIntake(workspace).read(job.input.id);if(proposal.manifest.recordId!==job.scope||job.id!==(job.type==='intake.stage'?proposal.stageJob:proposal.applyJob)||job.input.size!==proposal.manifest.files.reduce((n,file)=>n+file.size,0))damaged();return record(job.scope);}
   if(publications.has(job.type)){
    if(job.scope!==inventory.namespaceId)damaged();if(job.input.websiteId==null)return {kind:'workspace',selected:false};
    if(!researchId(job.input.websiteId))damaged();const website=await inventory.website(job.input.websiteId);
    if(!website||website.id!==job.input.websiteId||website.ambiguous!==false||website.projectId!==null&&!researchId(website.projectId))ownership();
    // A named website can belong to the workspace, just like the default site.
    // Normalize the authenticated scope before metadata write admission uses it.
    return {...website,kind:website.projectId===null?'workspace':'project',selected:website.projectId!==null&&website.projectId===inventory.projectId};
   }
   if(job.type==='media.prepare'){
    const session=await new MediaImports(workspace).read(job.id),declared=await inventory.mediaImport?.(job.id);
    if(job.scope!==inventory.namespaceId||session.workspaceId!==job.scope||job.input.importId!==job.id||job.input.size!==session.size)damaged();
    if(!declared||declared.id!==job.id||declared.sourceNamespace!==inventory.namespaceId||declared.revision!==fingerprint(session)||!['workspace','project'].includes(declared.kind)||declared.kind==='project'&&!researchId(declared.projectId))ownership();
    return {...declared,selected:declared.kind==='project'&&declared.projectId===inventory.projectId};
   }
   // Unknown work is never silently dropped or attributed from a UUID alone.
   // Additional job domains provide their own transfer and ownership contract.
   throw new AppError('JOB_UNSUPPORTED');
  };
}
