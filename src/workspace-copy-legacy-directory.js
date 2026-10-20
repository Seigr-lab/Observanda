// Older interrupted receipts keep their original bounded envelope. Complete
// their directory publication without activating an archive-only destination.
import path from 'node:path';
import {AppError} from './errors.js';
import {serialize,digest,workspaceFile} from './storage.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {backupCatalogue} from './postgres.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {inspectArchivedOwnerDirectory} from './owner-directory-archive.js';
import {NativeOwnerDirectory} from './owner-directory.js';
import {ownerDirectoryMarker} from './owner-directory-model.js';
const ordered=value=>({...value,...Object.fromEntries(['projects','deleted','relocated'].filter(key=>Array.isArray(value[key])).map(key=>[key,[...value[key]].sort((a,b)=>a.projectId<b.projectId?-1:a.projectId>b.projectId?1:0)]))});
export const sameCopiedWorkspaceDirectory=(a,b)=>serialize(ordered(a))===serialize(ordered(b));
function* rows(value){for(const state of ['active','deleted','relocated'])for(const entry of value[state==='active'?'projects':state]??[])yield {state,entry:{...entry,...(state==='active'?{summary:entry.summary??null}:{})}};}
export async function readCopiedWorkspaceDirectory(registry){
 const envelope=await registry.directoryOwner.access.envelope();if(!envelope.marker)return {value:envelope.value,revision:envelope.revision};
 if(await catalogueBinding(registry.workspace.root))return registry.read();
 const hash=await hashWorkspaceFile(path.join(registry.workspace.root,CATALOGUE_ARCHIVE),{reportProgress:false});
 return inspectArchivedOwnerDirectory(registry,hash,async view=>{
  const value={version:7,workspaceId:registry.workspaceId,projects:[],deleted:[],relocated:[],aliases:view.aliases};
  for await(const row of view.entries({index:'identity'}))value[row.state==='active'?'projects':row.state].push(row.entry);
  return {value,revision:view.revision};
 });
}
export async function publishCopiedWorkspaceDirectory(registry,initial,expected,finish){
 const target=registry.workspace;
 if(await target.storageKind()!=='catalogue'){if(!sameCopiedWorkspaceDirectory(initial.value,expected))await registry.change(initial.revision,()=>expected);await finish();return;}
 const db=await target.openCatalogue({detached:true});let marker;
 try{
  await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ');const store=target.catalogueStore(db);
  await target.inspectCatalogue(store,async()=>{
   const envelope=await registry.directoryOwner.access.envelope(),directory=new NativeOwnerDirectory(store,{kind:'projects',ownerId:registry.workspaceId});
   let current=envelope.marker?await directory.head({required:true}):null;
   if((current?.revision??envelope.revision)!==initial.revision)throw new AppError('CONFLICT');
   if(!sameCopiedWorkspaceDirectory(initial.value,expected)){
    if(!current){const metadata=(await store.snapshot()).metadata;current=await directory.initialize({raw:envelope.raw,entries:rows(initial.value),aliases:initial.value.aliases??null,legacy:metadata.projects.map(entry=>({projectId:entry.id,parentId:entry.parentId??null}))});}
    const next=await directory.applyBatch(current.value,rows(expected));next.aliases=expected.aliases??null;await directory.publish(next);
    if(!envelope.marker)marker=ownerDirectoryMarker('projects',registry.workspaceId,digest(serialize(next.receipt)));
   }
   // Legacy reconciliation reads only the destination being published. Borrow
   // this detached transaction so it cannot create a normal catalogue binding.
   await finish();await store.verify(JSON.parse(await target.readFile(await workspaceFile(target.root),'utf8')));
   await db.run('COMMIT');await backupCatalogue(target.root,target.root,{connection:db});
  });
  if(marker)await target.writeFile(registry.file,serialize(marker));
 }catch(error){await db.run('ROLLBACK').catch(()=>{});throw error;}finally{await db.close();}
}
