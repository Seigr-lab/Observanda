// Projects are placed at a workspace's top level. An earlier version could also place a project inside another
// project, and such trees still exist: they open, rename, keep their books and can move to the top level.
// These helpers leave a project exactly as that version did, so tests can build those trees as existing data.
import path from 'node:path';
import {rename} from 'node:fs/promises';
import {AppError} from '../../src/errors.js';

// Registers a project folder initialized inside its parent's folder, as an earlier version attached it.
export async function attachAsEarlierVersion(registry,storage,{parentId=null,expected}={}){
 if(parentId===null)return registry.attach(storage,{expected});
 const entry=await registry.describe(storage,parentId);
 return registry.apply(expected,[{state:'active',entry}],{check:async(directory,head)=>{if(await directory.find(head,entry.projectId))throw new AppError('EXISTS');}});
}

// Moves a registered top-level project into its parent's folder and records the parent, as an earlier version placed it.
// Its lab books are located relative to the project, so they move with it. Returns the project's new entry.
export async function nestAsEarlierVersion({provider,registry,projectId,parent}){
 const current=await registry.state(projectId),nested=path.join(parent.root,path.basename(current.entry.root));
 await provider.closeProject(current.entry.root);await rename(current.entry.root,nested);
 const entry={...current.entry,root:nested,parentId:parent.projectId};await registry.directoryOwner.apply(current.revision,[{state:'active',entry}]);return entry;
}
