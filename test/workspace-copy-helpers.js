import {workspaceFiles} from '../src/workspace-inventory.js';
import {copyWorkspace,transferDestination} from '../src/locations.js';
import {withOperationProgress} from '../src/operation-progress.js';
// Test conveniences over the product's inventory and copy calls.
export async function workspaceManifest(root){
 const files=await Array.fromAsync(workspaceFiles(root));return files.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function copyWorkspaceTo(root,input,options={}){
 return withOperationProgress(options.onProgress,async()=>copyWorkspace(await transferDestination(root,input),options));
}
