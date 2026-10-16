import {AppError} from './errors.js';
import {validateRecordEdits} from './research.js';
import {WORKSPACE_EDIT_FIELDS} from './web/workspace-edits.js';
import {validWebsiteSelection} from './web/website-selection.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function workspaceEditMetadata(source,command){
 const metadata={...structuredClone(source),...structuredClone(command.metadata)};
 for(const item of command.projects){
  const project=metadata.projects.find(p=>p.id===item.id);if(!project)throw new AppError('INVALID');
  project.share=item.share;project.logoId=item.logoId;
 }
 return metadata;
}

// Shared wire contract for committing presentation edits and previewing them.
// Validation does not authorize a save or mutate the selected snapshot.
export function validateWorkspaceEditCommand(command){
  if(!exact(command,['workspaceId','baseEtag','metadata','projects','changes','removed',...(Object.hasOwn(command??{},'selection')?['selection']:[])])||!uuid(command.workspaceId)||!revision(command.baseEtag)||
   !object(command.metadata)||Object.keys(command.metadata).some(k=>!WORKSPACE_EDIT_FIELDS.includes(k))||!Array.isArray(command.projects)||!Array.isArray(command.removed))throw new AppError('INVALID');
  if(command.selection!==undefined&&!validWebsiteSelection(command.selection))throw new AppError('INVALID');
  validateRecordEdits(command.changes);
  const identifiers=new Set(command.changes.map(c=>c.id)),projects=new Set();
  for(const item of command.removed){
   if(!exact(item,['id','expectedRevision'])||!uuid(item.id)||!revision(item.expectedRevision)||identifiers.has(item.id))throw new AppError('INVALID');
   identifiers.add(item.id);
  }
  for(const item of command.projects){
   if(!exact(item,['id','share','logoId'])||!uuid(item.id)||typeof item.share!=='boolean'||!(item.logoId===null||uuid(item.logoId))||projects.has(item.id))throw new AppError('INVALID');
   projects.add(item.id);
  }
}
