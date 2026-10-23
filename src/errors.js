import {DatasetResourceError} from './web/dataset-resource-policy.js';
import messages from './web/locales/en/errors.json' with {type:'json'};

export class AppError extends Error {
  constructor(code, details = []) {
    super(messages[code] ?? messages.IO);
    this.code = Object.hasOwn(messages, code) ? code : 'IO';
    this.details = details;
  }
}

const ownerId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function safeError(error) {
  if(error instanceof DatasetResourceError)error=new AppError('DATASET_CALCULATION_RESOURCE');
  if(!(error instanceof AppError))return {code:'IO',message:messages.IO,details:[]};
  const result={code:error.code,message:error.message,details:error.details};
  // JSON and progress streams must identify the same authorized owner so
  // clients can request the correct credentials. Never forward raw paths.
  if(ownerId(error.projectId)){
    result.projectId=error.projectId;
    if(typeof error.projectName==='string'&&error.projectName.length<=160&&!/[\\/:\r\n\0]/.test(error.projectName))result.projectName=error.projectName;
    if(ownerId(error.labBookId)){
      result.labBookId=error.labBookId;
      if(typeof error.labBookName==='string'&&error.labBookName.length<=160&&!/[\\/:\r\n\0]/.test(error.labBookName))result.labBookName=error.labBookName;
    }
  }
  if(ownerId(error.sourceWorkspaceId))result.sourceWorkspaceId=error.sourceWorkspaceId;
  if(ownerId(error.destinationWorkspaceId))result.destinationWorkspaceId=error.destinationWorkspaceId;
  if(error.code==='PROJECT_MOVED'&&ownerId(error.workspaceId))result.workspaceId=error.workspaceId;
  if(error.operationNotStarted===true)result.operationNotStarted=true;
  return result;
}
