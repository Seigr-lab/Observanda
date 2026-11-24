import {AppError} from '../errors.js';
// The activity index holds only {count}; anything else is damage, never a fresh start.
function auditCount(raw){let value;try{value=JSON.parse(raw);}catch{throw new AppError('COLLABORATION_DAMAGED');}if(!value||Object.keys(value).join()!=='count'||!Number.isSafeInteger(value.count)||value.count<0)throw new AppError('COLLABORATION_DAMAGED');return value.count;}
export async function auditLive(workspace,access,recordId,operation,detail){
 const prefix='.observanda/collaboration/live/activity/'+recordId+'/',file=prefix+'index.json',raw=await workspace.readMetadata(file,1024),count=raw?auditCount(raw):0;
 await workspace.writeMetadata(prefix+count+'.json',JSON.stringify({at:new Date().toISOString(),principalId:access.principalId,name:access.name,operation,...detail}));
 await workspace.writeMetadata(file,JSON.stringify({count:count+1}));
}
