// Collection discovery streams registry windows. Explicit source namespaces
// resolve directly, and every consumer receives only its current owner's scope.
import {LabBookDirectory} from './lab-book-directory.js';
import {AppError} from './errors.js';
export function withProjectCollectionDirectory(registry,{workspaceId,query,scope,selection,namespaces,signal},consume){
 return registry.inspect(async view=>{
  const active=async id=>{const row=await view.get(id);return row?.state==='active'?row.entry:null;},root=scope?await active(scope):null;
  if(scope&&!root)throw new AppError('NOT_FOUND');if(workspaceId!==(root?.namespaceId??registry.workspaceId))throw new AppError('WORKSPACE_CHANGED');
  const legacy=new Map(view.legacy.map(entry=>[entry.projectId,entry]));
  const lookup=async id=>await active(id)??legacy.get(id)??null;
  const below=async(entry,id)=>entry.projectId===id||(await view.ancestors(entry.projectId)).some(parent=>parent.projectId===id);
  const chosen=query?.projectId??scope,registered=chosen?await active(chosen):null;
  if(scope&&chosen!==scope&&(!registered||!await below(registered,scope)))throw new AppError('RECORD_VIEW_SCOPE');
  const selected=new Map(),labels={};if(selection)for(const id of selection.projectIds){const entry=await lookup(id);if(!entry||scope&&!await below(entry,scope))throw new AppError('RECORD_VIEW_SCOPE');selected.set(id,entry);labels[id]=entry.summary?.title??'';}
  const accepts=async entry=>{
   if(scope&&!await below(entry,scope))return false;
   if(!selection)return !chosen||registered&&await below(entry,chosen);
   if(selection.scopeMode==='all'||selected.has(entry.projectId))return true;
   if(selection.includeDescendants)for(const parent of selected.keys())if(await below(entry,parent))return true;
   return false;
  };
  const notebookIds=selection?.notebookMode==='selected'?new Set(selection.notebookIds):null;
  const ownerScope=async entry=>{
   if(!selection)return null;const entries=entry?[entry]:view.legacy.filter(value=>rootLegacy.has(value.projectId)),ids=new Set(entries.map(value=>value.projectId));if(!entry&&!scope&&selection.includeWorkspace)ids.add(null);
   return {projectIds:ids,projectOwners:new Map(entries.map(value=>[value.projectId,value.namespaceId??null])),projectLabels:labels,notebookIds};
  };
  const rootLegacy=new Set();if(selection)for(const entry of view.legacy)if(await accepts(entry))rootLegacy.add(entry.projectId);
  const includeRoot=selection?!scope&&(selection.includeWorkspace||rootLegacy.size>0):!scope&&(!chosen||!registered);
  const directory={revision:view.revision,includeRoot,chosen,ownerScope,async *projects(){
   if(namespaces){
    const ids=new Map();for(const namespaceId of namespaces){signal?.throwIfAborted();const row=await view.get(namespaceId,{index:'namespace'});if(row?.state==='active')ids.set(row.entry.projectId,row.entry);else if(namespaceId!==registry.workspaceId){const book=await new LabBookDirectory(registry).read(namespaceId);if(book){const entry=await active(book.projectId);if(entry)ids.set(entry.projectId,entry);}}}
    for(const entry of [...ids.values()].sort((a,b)=>a.namespaceId<b.namespaceId?-1:1))if(await accepts(entry))yield entry;return;
   }
   if(selection&&selection.scopeMode!=='all'&&!selection.includeDescendants){for(const entry of [...selected.values()].filter(value=>!value.legacy).sort((a,b)=>a.namespaceId<b.namespaceId?-1:1))if(await accepts(entry))yield entry;return;}
   for await(const row of view.entries({index:'namespace',signal})){signal?.throwIfAborted();if(row.state==='active'&&await accepts(row.entry))yield row.entry;}
  }};
  return consume(directory);
 },{legacy:true});
}
