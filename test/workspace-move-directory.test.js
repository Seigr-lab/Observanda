import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {NativeOwnerDirectory} from '../src/owner-directory.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {captureWorkspaceCopyDirectory,withWorkspaceCopyDirectory,workspaceCopyTransferId} from '../src/workspace-copy-directory.js';
import {withWorkspaceMoveDirectory,moveDirectoryAtSource} from '../src/workspace-move-directory.js';
import {Workspace,privateDirectory,serialize} from '../src/storage.js';
import {WorkspaceProjectMove,WORKSPACE_BUNDLE_MOVE} from '../src/workspace-project-move.js';
import {readMoveReceipt} from '../src/workspace-move.js';
import {ProjectLocationAccess} from '../src/project-location-access.js';
import {databaseRetention} from '../src/workspace-database-retention.js';
import {MOVE_SOURCE,MOVE_RECEIPT} from '../src/workspace-move-state.js';
import {clearVault} from '../src/encryption.js';

test('native move worklist retains exact order and boundaries beyond the old aggregate receipt size',{timeout:120000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-move-directory-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let vault;
 t.after(async()=>{await provider.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-move-directory-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'Source'),createNotebook('Workspace'));vault=f.vault;const owner=f.workspace,registry=new ProjectRegistry(owner,(await owner.outline()).metadata.id),destination=path.join(directory,'Destination');
 const make=(root,parentId=null)=>({projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),root,parentId,summary:null});
 const parent=make(path.join(directory,'External parent')),child=make(path.join(parent.root,'Child'),parent.projectId),internal=make(path.join(owner.root,'Nested folder','Internal project'));
 const rows=[parent,child,internal,...Array.from({length:512},(_,i)=>make(path.join(owner.root,'Project '+i.toString().padStart(4,'0')+' with a retained descriptive folder name')))];
 assert.ok(Buffer.byteLength(JSON.stringify(rows.map(row=>row.root)))>16384);
 await registry.applyBatch(await registry.version(),(async function*(){for(const entry of rows)yield {state:'active',entry};})());
 const pin=await captureWorkspaceCopyDirectory(registry),value={version:2,projectPlacement:2,id:randomUUID(),workspaceId:registry.workspaceId,source:owner.root,destination,directory:pin};
 assert.ok(Buffer.byteLength(JSON.stringify(value))<16384);
 const oldRead=ProjectRegistry.prototype.read,oldChange=ProjectRegistry.prototype.change;ProjectRegistry.prototype.read=ProjectRegistry.prototype.change=()=>{throw Error('No aggregate registry reads');};
 try{
  await withWorkspaceMoveDirectory(owner,value,async work=>{
   assert.equal(work.count,rows.length);let count=0,parentPosition,childPosition;
   for await(const entry of work.entries()){if(entry.projectId===parent.projectId)parentPosition=count;if(entry.projectId===child.projectId)childPosition=count;assert.equal(entry.transferId,workspaceCopyTransferId(value.id,entry.projectId));assert.equal((await work.get(entry.projectId)).root,entry.root);count++;}
   assert.equal(count,rows.length);assert.ok(parentPosition<childPosition);assert.deepEqual(await work.parents(await work.get(child.projectId)),[path.join(destination,'External parent')]);assert.equal(await work.hasChildren(parent.projectId),true);assert.equal(await work.hasChildren(child.projectId),false);
   assert.equal(await work.source(internal.root),true);assert.equal(await work.source(parent.root),false);assert.equal(await work.sourceContainer(path.join(owner.root,'Nested folder')),true);assert.equal(await work.sourceContainer(path.join(owner.root,'Unrelated')),false);assert.equal(await work.destination(path.join(destination,'External parent','Child')),true);assert.equal(await work.destinationContainer(path.join(destination,'Nested folder')),true);assert.equal(await work.destinationContainer(path.join(directory,'Other')),false);
   let reverse=rows.length-1;for await(const entry of work.entries({reverse:true})){if(entry.projectId===parent.projectId)assert.equal(reverse,parentPosition);if(entry.projectId===child.projectId)assert.equal(reverse,childPosition);reverse--;}assert.equal(reverse,-1);
  });
  const extra=make(path.join(owner.root,'Added while pending'));await registry.apply(await registry.version(),[{state:'active',entry:extra}]);
  const target=new Workspace(destination,vault);await mkdir(destination);await privateDirectory(destination,'.observanda');await target.writeFile(path.join(destination,WORKSPACE_BUNDLE_MOVE),serialize({...value,vaultId:vault.id,phase:'workspace'}));
  await assert.rejects(new WorkspaceProjectMove(owner,{withProject:async()=>assert.fail('Changed pending membership must refuse before owner access')}).run(destination,{activate:async()=>assert.fail('Changed pending membership must not activate')}),{code:'CONFLICT'});
  await registry.apply(await registry.version(),[{state:'active',entry:{...internal,root:path.join(destination,'Changed current location')}}]);
  await withWorkspaceMoveDirectory(owner,value,async work=>assert.equal((await work.get(internal.projectId)).root,internal.root));
  await owner.catalogue(async store=>{const relocated=new NativeOwnerDirectory(store,{kind:'projects',ownerId:registry.workspaceId,root:destination}),head=await relocated.head({required:true});assert.equal((await relocated.find(head.value,internal.projectId)).entry.root,path.join(destination,'Changed current location'));await relocated.verify(head.value);});
  await withWorkspaceCopyDirectory(owner,pin,async view=>{
   const row=await view.get(internal.projectId),copied={...row,entry:{...row.entry,root:path.join(destination,path.relative(owner.root,row.entry.root))}},rebased=moveDirectoryAtSource({...view,get:async()=>copied},destination,owner.root);assert.equal((await rebased.get(internal.projectId)).entry.root,internal.root);
  });
 }finally{ProjectRegistry.prototype.read=oldRead;ProjectRegistry.prototype.change=oldChange;}
 await mkdir(path.join(destination,path.dirname(MOVE_RECEIPT)),{recursive:true});
 const old={version:1,id:value.id,source:owner.root,destination,phase:'verified',inventorySalt:value.id,fingerprint:'a'.repeat(64),fingerprintFiles:'b'.repeat(64),fileCount:0,bytes:0,transferFiles:0,fileBytes:0};
 await writeFile(path.join(destination,MOVE_RECEIPT),JSON.stringify(old));assert.equal((await readMoveReceipt(destination)).version,1);
 await writeFile(path.join(destination,MOVE_RECEIPT),JSON.stringify({...old,version:2,directory:pin}));await assert.rejects(readMoveReceipt(destination),{code:'STORAGE_MOVE_STATE'});
 // A denied grant during frozen-source retry must retain its actual access error.
 const frozenSource=path.join(directory,'Frozen source');await mkdir(path.join(frozenSource,'.observanda'),{recursive:true});
 const handoff={...old,source:frozenSource,destination:owner.root,version:2,directory:pin,ownedDatabase:true,databaseRetention:await owner.catalogue(store=>databaseRetention(store.db))};
 await writeFile(path.join(frozenSource,MOVE_SOURCE),JSON.stringify({id:handoff.id,destination:owner.root}));await writeFile(path.join(owner.root,MOVE_RECEIPT),JSON.stringify(handoff));
 const session=new Map([[parent.projectId,{locked:true}]]);let registryCalls=0;
 const application={workspace:{root:frozenSource,vault},closed:false,registry:async()=>{assert.equal(++registryCalls,1,'Frozen source registry must not be reopened for an error label');return registry;},session:()=>session,tracked:operation=>operation()};
 const grants=new ProjectLocationAccess(application,{});try{await grants.prepareMove(owner.root);await assert.rejects(grants.withProject(parent.projectId,()=>assert.fail('Locked grant cannot open a project')),error=>error.code==='ACCESS_LOCKED'&&error.projectId===parent.projectId&&error.projectName===path.basename(parent.root));}finally{await grants.close();}

});
