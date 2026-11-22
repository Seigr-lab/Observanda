// The Move workspace destination check. A destination holding this workspace's
// interrupted copy preparation resumes it; any other destination must be usable.
import {resolveLocation,probeLocation} from './locations.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
export async function checkWorkspaceMoveDestination(source,input){
 const root=await resolveLocation(input);
 if(await new WorkspaceCopyRecovery(source,root).emptyPreparation())return {root,kind:'move',resume:true};
 return probeLocation(root);
}
