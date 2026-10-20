// A move pins the existing authenticated owner directory. Only encrypted scratch
// holds the ordered placement worklist; durable receipts retain its fixed head.
import path from 'node:path';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {workspaceProjectPlacements} from './workspace-project-placement.js';
import {withWorkspaceCopyDirectory,visitWorkspaceCopyPlacements,workspaceCopyTransferId} from './workspace-copy-directory.js';
const inside=(parent,child)=>{const r=path.relative(parent,child);return r!==''&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
export function moveDirectoryAtSource(view,currentRoot,source){
 const original=row=>row?{...row,entry:{...row.entry,root:inside(currentRoot,row.entry.root)?path.join(source,path.relative(currentRoot,row.entry.root)):row.entry.root}}:row;
 return {...view,get:async(...args)=>original(await view.get(...args)),entries:async function*(options){for await(const row of view.entries(options))yield original(row);}};
}
export async function withWorkspaceMoveDirectory(workspace,value,operation){
 return withScratch(async work=>{
  let count=0;
  const append=async selected=>{
   const entry={...selected,transferId:selected.transferId??workspaceCopyTransferId(value.id,selected.projectId)};
   await work.put('order:'+count++,entry);await work.put('id:'+entry.projectId,entry);
   if(entry.parentId!==null)await work.add('children:'+entry.parentId);
   await work.add('destination:'+entry.destination);
   for(let root=path.dirname(entry.destination);inside(value.destination,root);root=path.dirname(root))await work.add('destination-prefix:'+root);
   if(inside(value.source,entry.root)){
    await work.add('source:'+entry.root);
    for(let root=path.dirname(entry.root);inside(value.source,root);root=path.dirname(root))await work.add('source-prefix:'+root);
   }
  };
  if(value.version===1){for(const entry of workspaceProjectPlacements(value.source,value.destination,value.projects,{version:value.projectPlacement??1}))await append(entry);}
  else await withWorkspaceCopyDirectory(workspace,value.directory,view=>visitWorkspaceCopyPlacements(moveDirectoryAtSource(view,workspace.root,value.source),value.source,value.destination,append));
  return operation({count,
   async *entries({reverse=false}={}){for(let i=reverse?count-1:0;reverse?i>=0:i<count;reverse?i--:i++)yield await work.get('order:'+i);},
   get:id=>work.get('id:'+id),hasChildren:id=>work.has('children:'+id),
   async parents(entry){const result=[];for(let id=entry.parentId;id!==null;){const parent=await work.get('id:'+id);if(!parent)throw new AppError('STORAGE_MOVE_STATE');result.push(parent.destination);id=parent.parentId;}return result;},
   destination:root=>work.has('destination:'+root),destinationContainer:root=>work.has('destination-prefix:'+root),
   source:root=>work.has('source:'+root),async sourceContainer(root){return await work.has('source:'+root)||await work.has('source-prefix:'+root);}
  });
 });
}
