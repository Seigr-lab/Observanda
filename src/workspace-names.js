// Workspace-specific messages over the common literal storage-name contract.
import {validateStorageName,storageFolderName,storageCreationPath,requireStorageName} from './storage-names.js';
const optionsFor=options=>({...options,nameError:'WORKSPACE_NAME',mismatchError:'WORKSPACE_NAME_MISMATCH'});
export function validateWorkspaceName(name,options){return validateStorageName(name,optionsFor(options));}
export function workspaceFolderName(root,options){return storageFolderName(root,options);}
export function workspaceCreationPath(parent,name,options){return storageCreationPath(parent,name,optionsFor(options));}
export function requireWorkspaceName(root,name,options){return requireStorageName(root,name,optionsFor(options));}
