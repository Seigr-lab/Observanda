import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pendingWorkspaceProjectMoves} from '../src/project-workspace-move-location.js';
import {Workspace} from '../src/storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {clearVault} from '../src/encryption.js';
import {NativePortabilityCollection} from '../src/portability-collection.js';
import {validateProjectWorkspaceMove,saveProjectWorkspaceMove,readProjectWorkspaceMove,projectWorkspaceMoveFile} from '../src/project-workspace-move-state.js';
const ids=()=>({projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID()});
const hash='a'.repeat(64);
const ref=count=>{const value=new NativePortabilityCollection(null,randomUUID()).empty();value.count=count;if(count)value.roots.order={count,height:1,hash,first:'0',last:String(count)};return value;};
function model(sourceRoot,targetRoot){
 const workspaceId=randomUUID(),root=ids(),targetWorkspaceId=randomUUID(),identity={dev:'1',ino:'2'};
 return {registry:new ProjectRegistry({root:sourceRoot},workspaceId),value:{version:1,id:randomUUID(),workspaceId,...root,parentId:null,placement:{parentId:null,expectedParentId:null},source:'Project 1',destination:'Project 1',identity,accessHash:hash,descriptorHash:hash,phase:'prepared',target:{root:targetRoot,workspaceId:targetWorkspaceId,vaultId:randomUUID(),identity,parentIdentity:identity,parentRelative:''},ownerDirectoryVersion:2,owners:ref(1),ownerKeys:ref(0),projectRegistryRevision:hash}};
}

test('workspace handoff journals reject escaping locations, incorrect owner journals and receipts without an owner directory',()=>{
 const {registry,value}=model(path.resolve('Source Workspace'),path.resolve('Target Workspace')),validate=v=>validateProjectWorkspaceMove(registry,value.projectId,v);assert.equal(validate(value),value);
 for(const edit of [v=>v.source='../outside',v=>v.destination='../outside',v=>v.target.root=registry.workspace.root,v=>v.target.root=path.join(registry.workspace.root,'Nested Workspace'),v=>v.target.workspaceId=registry.workspaceId,v=>v.target.identity.ino='unknown',v=>v.placement.expectedParentId=randomUUID(),v=>v.placement.parentId=randomUUID(),v=>v.version=2,v=>delete v.ownerDirectoryVersion,v=>v.ownerDirectoryVersion=1,v=>v.ownerKeys.id=v.owners.id,v=>v.ownerKeys=ref(1),v=>v.projectRegistryRevision='bad']){
  const invalid=structuredClone(value);edit(invalid);assert.throws(()=>validate(invalid),{code:'STORAGE_MOVE_STATE'});
 }
 for(const phase of ['frozen','copying','moved','registered','departing','departed','complete'])assert.equal(validate({...value,phase}).phase,phase);
 assert.equal(validate({...value,phase:'cancelled',keysReleased:true,owners:ref(0),ownerKeys:ref(0)}).phase,'cancelled');
});

test('encrypted handoff journals keep the peer location private and completed history out of pending discovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-handoff-state-')),source=path.join(directory,'Source Workspace'),target=path.join(directory,'Target Workspace'),sourceKey={id:randomUUID(),key:randomBytes(32)};
 t.after(async()=>{await clearVault(sourceKey);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-handoff-state-'));await rm(directory,{recursive:true,force:true});});
 await mkdir(path.join(source,'.observanda'),{recursive:true});const {value}=model(source,target);
 const from=new ProjectRegistry(new Workspace(source,sourceKey),value.workspaceId);
 await saveProjectWorkspaceMove(from,value);assert.deepEqual(await readProjectWorkspaceMove(from,value.projectId),value);assert.ok(!(await readFile(projectWorkspaceMoveFile(from,value.projectId))).includes(Buffer.from(target)));
 // Completed history stays addressable for acknowledgement but is not read by
 // pending discovery, even if that old history is inaccessible or damaged.
 const completed={...value,phase:'complete',released:true};await saveProjectWorkspaceMove(from,completed);assert.deepEqual(await readProjectWorkspaceMove(from,value.projectId),completed);await assert.rejects(readFile(projectWorkspaceMoveFile(from,value.projectId)),{code:'ENOENT'});
 await from.workspace.writeFile(projectWorkspaceMoveFile(from,value.projectId,true),'damaged completed receipt');assert.deepEqual(await pendingWorkspaceProjectMoves(from),{items:[],next:null});await saveProjectWorkspaceMove(from,completed);
 // A crash after the completed receipt but before consuming the pending one
 // remains visible and can repeat the final acknowledgement.
 await from.workspace.writeFile(projectWorkspaceMoveFile(from,value.projectId),JSON.stringify({...value,phase:'complete'}));assert.equal((await pendingWorkspaceProjectMoves(from)).items.length,1);assert.equal((await readProjectWorkspaceMove(from,value.projectId)).released,undefined);await saveProjectWorkspaceMove(from,completed);assert.deepEqual(await pendingWorkspaceProjectMoves(from),{items:[],next:null});
 const next={...value,id:randomUUID()};await saveProjectWorkspaceMove(from,next);assert.equal((await readProjectWorkspaceMove(from,value.projectId)).id,next.id);assert.equal((await pendingWorkspaceProjectMoves(from)).items[0].id,next.id);
 // A receipt without the native owner directory is refused as damaged.
 const {ownerDirectoryVersion,owners,ownerKeys,...unowned}=next;await from.workspace.writeFile(projectWorkspaceMoveFile(from,value.projectId),JSON.stringify(unowned));await assert.rejects(readProjectWorkspaceMove(from,value.projectId),{code:'STORAGE_MOVE_STATE'});
});
