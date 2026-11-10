import {withComparisonInputs} from '../comparison-request-inputs.js';
import {MAX_BYTES} from '../model.js';
// The local CLI and authenticated UI share this versioned command boundary.
import {AppError} from '../errors.js';
import {LocalIntake} from './service.js';
import {RunReadiness} from '../run-readiness.js';
export async function intakeCommand(workspace,queue,action,command,options={}){
 if(!command||command.version!==1)throw new AppError('INTAKE_INVALID');
 const {version,...input}=command;void version;
 const service=new LocalIntake(workspace,queue);
 if(['builder-profiles','builder-adapters','builder-adapter-read','builder-adapter-save'].includes(action)){
  const {intakeAdapterRequest}=await import('./adapter.js');return intakeAdapterRequest(service,action,input,options);
 }
 if(action==='builder-target'){
  const {record}=await service.bind(input,{checkRevision:false});
  return {id:record.id,title:record.title,revision:record.revision,workspaceId:record.workspaceId};
 }
 if(action==='builder-antecedents'){
  const {workspaceId,recordId,cursor}=input;await service.bind(input,{checkRevision:false});
  const page=await service.feed(recordId).page({cursor,limit:12}),items=[];
  for(const item of page.items){
   options.signal?.throwIfAborted();const proposal=await service.bound({workspaceId,recordId,id:item.id});
   if(proposal.state==='completed')items.push({id:item.id,pin:proposal.pin,title:proposal.manifest.title,date:proposal.receipt.committedAt});
  }
  return {items,next:page.next};
 }
 if(['builder-files','builder-folder','builder-review'].includes(action)){
  const {builderFiles,builderFolder,buildIntake}=await import('./builder.js');
  if(action==='builder-files')return builderFiles(service,input,options);
  return action==='builder-folder'?builderFolder(service,input,options):buildIntake(service,input,options);
 }
 if(action==='readiness'){const readiness=new RunReadiness(workspace);return withComparisonInputs(readiness.materials,options,inputs=>readiness.view(input,{...options,inputs}));}
 if(action==='receipt-websites')return new RunReadiness(workspace).websites(input,options);
 if(action==='receipt-editions')return new RunReadiness(workspace).editions(input,options);
 if(action==='link-receipt')return new RunReadiness(workspace).link(input);
 if(action==='policy')return new RunReadiness(workspace).setPolicy(input);
 if(['preview','stage','apply','status','list'].includes(action))return service[action](input,options);
 if(action==='cancel'||action==='resume')return service.control(input,action==='resume'?'retry':'cancel');
 throw new AppError('NOT_FOUND');
}

const readActions=new Set(['readiness','receipt-websites','receipt-editions','preview','status','list','builder-target','builder-antecedents','builder-files','builder-folder','builder-review','builder-adapters','builder-profiles','builder-adapter-read']);
const writeActions=new Set(['link-receipt','policy','stage','apply','cancel','resume','builder-adapter-save']);
export function intakeRequest(route){
 const prefix='/api/v1/intake/';if(!route.startsWith(prefix))return null;const action=route.slice(prefix.length);
 return readActions.has(action)||writeActions.has(action)?{intake:action,write:writeActions.has(action),limit:MAX_BYTES}:null;
}
