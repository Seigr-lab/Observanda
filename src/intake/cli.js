import {setTimeout as pause} from 'node:timers/promises';
import {AppError} from '../errors.js';
import {workspaceJobs} from '../workspace-jobs.js';
import {intakeCommand} from './commands.js';
import {watchIntake} from './watch.js';
export async function intakeCLI(workspace,values,{signal}={}){
 if(!values.workspace||!values['workspace-id']||!values['record-id']||!values.action)throw new AppError('INTAKE_INVALID');
 if(Object.keys(values).some(k=>!['workspace','workspace-id','record-id','action','source','id','pin','wait','password-stdin','preferences','json'].includes(k)))throw new AppError('INTAKE_INVALID');
 const jobs=workspaceJobs(workspace),command={version:1,workspaceId:values['workspace-id'],recordId:values['record-id'],...(values.source?{source:values.source}:{}),...(values.id?{id:values.id}:{}),...(values.pin?{expectedPin:values.pin}:{})};
 try{
  if(values.action==='watch'){
   if(!values.source)throw new AppError('INTAKE_INVALID');
   await watchIntake(values.source,source=>intakeCommand(workspace,jobs.queue,'preview',{...command,source},{signal}),{signal,onNotice:notice=>console.log(JSON.stringify(notice))});return {version:1,stopped:true};
  }
  let result=await intakeCommand(workspace,jobs.queue,values.action,command,{signal});
  if(values.wait&&['stage','apply','resume'].includes(values.action)){
   jobs.worker.start();
   while(result.job&&['queued','running'].includes(result.job.state)){
    signal?.throwIfAborted();await pause(100,undefined,{signal});result=await intakeCommand(workspace,jobs.queue,'status',command);
   }
  }
  return result;
 }finally{await jobs.worker.stop();}
}
