// Applying an intake consumes the reviewed, retained bytes. The external
// source is only required while staging; it is not a portable dependency.
import {preparedIntakeFiles} from '../project-intake-content.js';
import {evidenceFileStamp} from '../project-evidence-file-stamp.js';
import {digest,serialize} from '../storage-format.js';
import {AppError} from '../errors.js';
const hash=value=>digest(serialize(value));
const identity=proposal=>hash({pin:proposal.pin,prepared:proposal.prepared});
export async function inspectPreparedIntake(service,proposal,{signal,progress=async()=>{}}={}){
 const files=preparedIntakeFiles(proposal);
 if(files.length!==proposal.manifest.files.length)throw new AppError('INTAKE_NOT_READY');
 const report={version:1,pin:proposal.pin,identity:identity(proposal),files:[]};
 let done=0;const total=files.reduce((sum,file)=>sum+file.size,0);
 for(let i=0;i<files.length;i++){
  signal?.throwIfAborted();const file=files[i],stamp=await evidenceFileStamp(service.workspace.root,file.relative),content=await service.preparedContent(proposal,proposal.prepared[i]);
  if(content.sha256!==file.sha256||content.size!==file.size)throw new AppError('MATERIAL_MISSING');
  await content.verify({signal,onProgress:current=>progress({stage:'validating',done:done+current,total,unit:'bytes'})});
  if(hash(stamp)!==hash(await evidenceFileStamp(service.workspace.root,file.relative)))throw new AppError('INTAKE_CHANGED');
  report.files.push({relative:file.relative,stamp});done+=file.size;
 }
 return report;
}
export async function assertPreparedIntakeUnchanged(workspace,proposal,report){
 const files=preparedIntakeFiles(proposal);
 if(report?.version!==1||report.pin!==proposal.pin||report.identity!==identity(proposal)||files.length!==proposal.manifest.files.length||!Array.isArray(report.files)||report.files.length!==files.length)throw new AppError('INTAKE_CHANGED');
 for(let i=0;i<files.length;i++){
  const file=files[i],saved=report.files[i];
  if(saved?.relative!==file.relative||hash(saved.stamp)!==hash(await evidenceFileStamp(workspace.root,file.relative)))throw new AppError('INTAKE_CHANGED');
 }
}
