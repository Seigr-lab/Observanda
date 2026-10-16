import {Workspace} from '../../src/storage.js';
import {WorkspaceRenames} from '../../src/workspace-rename.js';
const [root,journal,name,boundary]=process.argv.slice(2);
await new WorkspaceRenames(journal).begin(new Workspace(root),name,{checkpoint:async phase=>{
 if(phase!==boundary)return;process.stdout.write('checkpoint\n');await new Promise(()=>{});
}});
