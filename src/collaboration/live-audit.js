export async function auditLive(workspace,access,recordId,operation,detail){
 const prefix='.observanda/collaboration/live/activity/'+recordId+'/',file=prefix+'index.json',raw=await workspace.readMetadata(file,1024),count=raw?JSON.parse(raw).count:0;
 await workspace.writeMetadata(prefix+count+'.json',JSON.stringify({at:new Date().toISOString(),principalId:access.principalId,name:access.name,operation,...detail}));
 await workspace.writeMetadata(file,JSON.stringify({count:count+1}));
}
