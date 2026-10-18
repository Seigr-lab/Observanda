// Independent lifecycle checks overlap their filesystem waits. Every admission
// point still runs all three checks, including after acquiring a writer lock.
// Nothing is cached between transactions or across a lock wait.
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotRenaming} from './workspace-rename-state.js';
export async function assertWorkspaceAvailable(root,{deleteId,moveId}={}){
 const results=await Promise.allSettled([assertNotDeleting(root,deleteId),assertNotMoving(root,moveId),assertNotRenaming(root)]);
 // Preserve the established deletion, movement, then rename error priority.
 const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
}
