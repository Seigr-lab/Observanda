// Local proposals and their record feeds use the manifest's explicit target.
// No external folder is inspected merely to classify a metadata difference.
import {LocalIntake} from './intake/service.js';
import {AppError} from './errors.js';
const root='metadata:.observanda/intake/';
export function projectSourceIntakeOwner(store,inventory,record,{signal}={}){
 return async id=>{
  if(!id.startsWith(root))return null;signal?.throwIfAborted();let match;
  const tail=id.slice(root.length);
  if((match=/^by-record\/([a-f0-9-]{36})(?:-order\.json|(?:-order)?\/[^/]+\.json)$/.exec(tail)))return record(match[1]);
  if((match=/^proposals\/([a-f0-9-]{36})\.json$/.exec(tail)))return store.workspace.inspectCatalogue(store,async()=>{
   const value=await new LocalIntake(store.workspace).read(match[1]);if(value.manifest.workspaceId!==inventory.namespaceId)throw new AppError('WORKSPACE_CHANGED');return record(value.manifest.recordId);
  });
  return null;
 };
}
