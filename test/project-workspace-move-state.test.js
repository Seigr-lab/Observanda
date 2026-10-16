import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pendingWorkspaceProjectMoves} from '../src/project-workspace-move-location.js';
import {withWriterLease} from '../src/writer-lease.js';
import {Workspace} from '../src/storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {clearVault} from '../src/encryption.js';
import {validateProjectWorkspaceMove,saveProjectWorkspaceMove,readProjectWorkspaceMove,projectWorkspaceMoveFile} from '../src/project-workspace-move-state.js';
import {reserveIncomingProjectMove,releaseIncomingProjectMove,incomingProjectMove,assertIncomingProjectMovesSettled,assertIncomingProjectAddresses} from '../src/project-incoming-moves.js';
const ids=()=>({projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID()});
function model(sourceRoot,targetRoot){
 const workspaceId=randomUUID(),root=ids(),targetWorkspaceId=randomUUID(),identity={dev:'1',ino:'2'},hash='a'.repeat(64);
 return {registry:new ProjectRegistry({root:sourceRoot},workspaceId),value:{version:1,id:randomUUID(),workspaceId,...root,parentId:null,placement:{parentId:null,expectedParentId:null},source:'Project 1',destination:'Project 1',identity,accessHash:hash,descriptorHash:hash,phase:'prepared',rootBooks:{},target:{root:targetRoot,workspaceId:targetWorkspaceId,vaultId:randomUUID(),identity,parentIdentity:identity,parentRelative:''},entries:[{...root,parentId:null,relative:'',summary:null}]}};
}

test('workspace handoff journals reject escaping locations, incorrect owner plans and malformed transfer proofs',()=>{
 const {registry,value}=model(path.resolve('Source Workspace'),path.resolve('Target Workspace')),validate=v=>validateProjectWorkspaceMove(registry,value.projectId,v);assert.equal(validate(value),value);
 for(const edit of [v=>v.source='../outside',v=>v.destination='../outside',v=>v.target.root=registry.workspace.root,v=>v.target.root=path.join(registry.workspace.root,'Nested Workspace'),v=>v.target.workspaceId=registry.workspaceId,v=>v.target.identity.ino='unknown',v=>v.entries[0].namespaceId=randomUUID(),v=>v.entries[0].relative='elsewhere',v=>v.entries[0].summary={title:37},v=>v.entries.push({...v.entries[0]}),v=>v.placement.expectedParentId=randomUUID(),v=>v.placement.parentId=randomUUID(),v=>v.phase='copying',v=>v.version=2]){
  const invalid=structuredClone(value);edit(invalid);assert.throws(()=>validate(invalid));
 }
 for(const phase of ['frozen','moved','registered','departing','departed','complete','cancelled'])assert.equal(validate({...value,phase}).phase,phase);
});

test('encrypted incoming reservations are repeatable, isolate other parents and recover interrupted release',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-handoff-state-')),source=path.join(directory,'Source Workspace'),target=path.join(directory,'Target Workspace'),sourceKey={id:randomUUID(),key:randomBytes(32)},targetKey={id:randomUUID(),key:randomBytes(32)};
 t.after(async()=>{clearVault(sourceKey);clearVault(targetKey);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-handoff-state-'));await rm(directory,{recursive:true,force:true});});
 await mkdir(path.join(source,'.observanda'),{recursive:true});await mkdir(path.join(target,'.observanda'),{recursive:true});const {value}=model(source,target);value.target.vaultId=targetKey.id;
 const from=new ProjectRegistry(new Workspace(source,sourceKey),value.workspaceId),to=new ProjectRegistry(new Workspace(target,targetKey),value.target.workspaceId);
 await saveProjectWorkspaceMove(from,value);assert.deepEqual(await readProjectWorkspaceMove(from,value.projectId),value);assert.ok(!(await readFile(projectWorkspaceMoveFile(from,value.projectId))).includes(Buffer.from(target)));
 await mkdir(path.join(target,'.observanda/project-import-addresses'),{recursive:true});
 await withWriterLease(path.join(target,'.observanda/project-import-addresses',value.namespaceId+'.lock'),async()=>{await assert.rejects(reserveIncomingProjectMove(to,value),{code:'LOCKED'});});
 assert.equal(await incomingProjectMove(to,value.projectId),null);
 await reserveIncomingProjectMove(to,value);await reserveIncomingProjectMove(to,value);assert.equal((await incomingProjectMove(to,value.projectId)).id,value.id);
 await assert.rejects(assertIncomingProjectMovesSettled(to,[null]),{code:'STORAGE_PROJECT_BUSY'});await assertIncomingProjectMovesSettled(to,[randomUUID()]);
 await assert.rejects(assertIncomingProjectAddresses(to,[{namespaceId:value.namespaceId,vaultId:randomUUID()}]),{code:'STORAGE_PROJECT_BUSY'});await assert.rejects(assertIncomingProjectAddresses(to,[{namespaceId:randomUUID(),vaultId:value.vaultId}]),{code:'STORAGE_PROJECT_BUSY'});await assertIncomingProjectAddresses(to,[ids()]);
 await assert.rejects(reserveIncomingProjectMove(to,{...value,id:randomUUID()}),{code:'STORAGE_PROJECT_BUSY'});
 const stateFile=path.join(target,'.observanda/project-incoming-owners',value.projectId+'.obsv');await to.workspace.writeFile(stateFile,JSON.stringify({...await incomingProjectMove(to,value.projectId),workspaceId:randomUUID()}));await assert.rejects(incomingProjectMove(to,value.projectId),{code:'STORAGE_MOVE_STATE'});
 await to.workspace.writeFile(stateFile,JSON.stringify({version:1,id:value.id,workspaceId:to.workspaceId,sourceWorkspaceId:from.workspaceId,projectId:value.projectId}));
 const invalid=structuredClone(value);invalid.workspaceId=randomUUID();await assert.rejects(releaseIncomingProjectMove(to,invalid),{code:'CONFLICT'});
 await releaseIncomingProjectMove(to,value);await releaseIncomingProjectMove(to,value);assert.equal(await incomingProjectMove(to,value.projectId),null);await assertIncomingProjectMovesSettled(to,[null]);
 // Completed history stays addressable for acknowledgement but is not read by
 // pending discovery, even if that old history is inaccessible or damaged.
 const completed={...value,phase:'complete',released:true};await saveProjectWorkspaceMove(from,completed);assert.deepEqual(await readProjectWorkspaceMove(from,value.projectId),completed);await assert.rejects(readFile(projectWorkspaceMoveFile(from,value.projectId)),{code:'ENOENT'});
 await from.workspace.writeFile(projectWorkspaceMoveFile(from,value.projectId,true),'damaged completed receipt');assert.deepEqual(await pendingWorkspaceProjectMoves(from),{items:[],next:null});await saveProjectWorkspaceMove(from,completed);
 // A crash after the completed receipt but before consuming the pending one
 // remains visible and can repeat the final acknowledgement.
 await from.workspace.writeFile(projectWorkspaceMoveFile(from,value.projectId),JSON.stringify({...value,phase:'complete'}));assert.equal((await pendingWorkspaceProjectMoves(from)).items.length,1);assert.equal((await readProjectWorkspaceMove(from,value.projectId)).released,undefined);await saveProjectWorkspaceMove(from,completed);assert.deepEqual(await pendingWorkspaceProjectMoves(from),{items:[],next:null});
 const next={...value,id:randomUUID()};await saveProjectWorkspaceMove(from,next);assert.equal((await readProjectWorkspaceMove(from,value.projectId)).id,next.id);assert.equal((await pendingWorkspaceProjectMoves(from)).items[0].id,next.id);

});
