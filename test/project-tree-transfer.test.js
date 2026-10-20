import {ProjectImports} from '../src/project-import.js';
import {ProjectImportInventory} from '../src/project-import-inventory.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,rename,access,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {Workspace,serialize} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCopies} from '../src/project-copy.js';
import {ProjectArchives} from '../src/project-archives.js';
import {ProjectRenames} from '../src/project-rename.js';
import {readProjectTree,validateProjectTree,projectTreeCollection} from '../src/project-tree-manifest.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,verifyAccess,readAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {catalogueBinding} from '../src/postgres-activation.js';

test('selected project copy and export retain the complete independent subtree',{timeout:600000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-tree-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[];
 t.after(async()=>{await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-tree-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device')}),password='Portable project tree password';
 async function grant(){const access=await createWorkspaceAccess('',password,device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};}
 const wg=await grant(),metadata=createNotebook('Source Workspace'),workspaceRoot=path.join(directory,metadata.title);await initializeLocation(workspaceRoot,metadata,wg.access,wg.vault);const workspace=new Workspace(workspaceRoot,wg.vault),registry=new ProjectRegistry(workspace,metadata.id),projects=new Map(),books=new Map();
 async function project(title,parent=null){const g=await grant(),data=createNotebook(title),id=randomUUID();data.projects=[{id,title,parentId:null,description:'Independent project',share:false,logoId:null}];const storage=await initializeProjectLocation(path.join(parent?.root??workspace.root,title),id,data,g.access,g.vault);await registry.attach(storage,{parentId:parent?.projectId??null,expected:(await registry.read()).revision});projects.set(id,storage);return storage;}
 async function book(parent,title){const result=await new LabBookCreation(parent,device).create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId:parent.projectId,title}}),vault=await verifyAccess(await readAccess(result.book.root),'',password,{deviceStore:device});keys.push(vault);const storage=new LabBookStorage(result.book.root,result.book.labBookId,vault);await storage.writeFile(path.join(storage.root,'.observanda/evidence.bin'),'Evidence for '+title);books.set(storage.labBookId,storage);return storage;}
 const root=await project('Research Project'),child=await project('Child Project',root),grand=await project('Grandchild Project',child),sibling=await project('Unrelated Project'),rootBook=await book(root,'Root Notes'),childBook=await book(child,'\u00c5ngstr\u00f6m Notes'),grandBook=await book(grand,'Grandchild Notes');
 const allOwners=[root,child,grand,rootBook,childBook,grandBook],snapshots=new Map();for(const item of allOwners)snapshots.set(item.root,await item.read());
 const supplied=allOwners.map(item=>({relative:path.relative(root.root,item.root).split(path.sep).join('/'),username:'',password,recovery:''})),inventory=new ProjectImportInventory(device,supplied);try{const found=await inventory.inspect(root.root);assert.equal(found.owners.length,6);assert.deepEqual(found.manifest.projects.map(item=>item.relative),['Child Project','Child Project/Grandchild Project']);}finally{inventory.close();}
 const callbacks={withProject:(id,use)=>use(projects.get(id)),withProjectBook:(parent,id,use)=>{assert.equal(path.dirname(books.get(id).root),parent.root);return use(books.get(id));},withBook:(id,use)=>use(books.get(id))};
 const copies=new ProjectCopies(registry),copyParent=path.join(directory,'Copies');await mkdir(copyParent);const copyPath=path.join(copyParent,path.basename(root.root)),id=randomUUID();
 await assert.rejects(copies.run(root,{id,path:copyPath,withBook:callbacks.withBook}),{code:'ACCESS_LOCKED'});assert.equal(await copies.read(root.projectId),null);await assert.rejects(access(copyPath),{code:'ENOENT'});
 let interrupted=false;await assert.rejects(copies.run(root,{id,path:copyPath,...callbacks,checkpoint:async phase=>{if(phase==='project'&&!interrupted){interrupted=true;const before=await sibling.read();before.book.description='Independent writer during export';await sibling.save(before.book,before.etag);throw Error('Child transfer interrupted');}}}),/Child transfer interrupted/);
 assert.equal((await readProjectTree(new ProjectStorage(copyPath,root.projectId,root.vault))).version,2);assert.equal((await copies.run(root,{id,resume:true,...callbacks})).phase,'complete');
 const target=new ProjectStorage(copyPath,root.projectId,root.vault),tree=await readProjectTree(target);const treeRows=[];for await(const row of projectTreeCollection(target,tree).entries())if(row.relative)treeRows.push(row);assert.deepEqual(treeRows.map(item=>item.relative),['Child Project','Child Project/Grandchild Project']);assert.ok(Buffer.byteLength(serialize(tree))<4096);assert.ok(!serialize(tree).includes(directory));
 const legacy={version:1,projectId:tree.projectId,namespaceId:tree.namespaceId,vaultId:tree.vaultId,projects:treeRows.map(({kind,...row})=>row)};assert.throws(()=>validateProjectTree({...legacy,projects:[{...legacy.projects[0],relative:'../outside'}]}),{code:'STORAGE_COPY'});assert.throws(()=>validateProjectTree({...legacy,projects:[{...legacy.projects[0],parentId:grand.projectId}]}),{code:'STORAGE_COPY'});
 for(const source of [root,child,grand]){const copied=new ProjectStorage(path.join(copyPath,path.relative(root.root,source.root)),source.projectId,source.vault);assert.deepEqual(await copied.read(),await source.read());}
 const exportParent=path.join(directory,'Exports');await mkdir(exportParent);const exported=path.join(exportParent,path.basename(root.root)),archives=new ProjectArchives(registry),exportId=randomUUID();
 await archives.run(root,{id:exportId,path:exported,...callbacks});
 for(const source of [root,child,grand,rootBook,childBook,grandBook]){const exportedRoot=path.join(exported,path.relative(root.root,source.root));assert.equal(await catalogueBinding(exportedRoot),null);await assert.rejects(access(path.join(exportedRoot,'.observanda/postgresql')),{code:'ENOENT'});}
 for(const source of books.values())await provider.closeLabBook(source.root);for(const source of projects.values())await provider.closeProject(source.root);await provider.closeWorkspace(workspace.root);await rename(workspace.root,path.join(directory,'Source unavailable'));
 const receiverGrant=await grant(),receiverMetadata=createNotebook('Receiver Workspace'),receiverRoot=path.join(directory,receiverMetadata.title);await initializeLocation(receiverRoot,receiverMetadata,receiverGrant.access,receiverGrant.vault);const receiver=new Workspace(receiverRoot,receiverGrant.vault),receiverRegistry=new ProjectRegistry(receiver,receiverMetadata.id);
 const containerGrant=await grant(),containerData=createNotebook('Containing Project'),containerId=randomUUID();containerData.projects=[{id:containerId,title:containerData.title,parentId:null,description:'',share:false,logoId:null}];const container=await initializeProjectLocation(path.join(receiver.root,containerData.title),containerId,containerData,containerGrant.access,containerGrant.vault);await receiverRegistry.attach(container,{expected:await receiverRegistry.version()});
 receiverRegistry.read=receiverRegistry.change=()=>{throw Error('Import must not materialize the destination registry');};
 const imports=new ProjectImports(receiverRegistry,device),importId=randomUUID(),request={id:importId,path:exported,parentId:containerId,username:'',password,recovery:'',owners:supplied.filter(item=>item.relative)};
 await assert.rejects(imports.run({...request,owners:request.owners.map(item=>({...item,password:item.relative==='Child Project'?'Incorrect password':password}))}),{code:'PROJECT_IMPORT_ACCESS'});assert.equal(await imports.read(importId),null);
 for(const stage of ['prepared','owner-file','owner-copied','owner-restored','copied','registered','addressed','complete']){
  let reached=false;await assert.rejects(imports.run(stage==='prepared'?request:{id:importId,username:'',password,recovery:'',owners:request.owners},{resume:stage!=='prepared',checkpoint:async phase=>{if(phase===stage&&!reached){reached=true;throw Error('Import interrupted '+stage);}}}),new RegExp('Import interrupted '+stage));assert.ok(reached);
  if(stage==='copied'){for(const source of allOwners){const at=path.join(exported,path.relative(root.root,source.root));assert.equal(await catalogueBinding(at),null);}await rename(exported,path.join(exportParent,'Backup unavailable'));}
  t.diagnostic('Project tree import resumed at '+stage);
 }
 const imported=await imports.run({id:importId,username:'',password,recovery:'',owners:request.owners},{resume:true});assert.equal(imported.complete,true);assert.equal(imported.project.root,path.join(container.root,'Research Project'));assert.deepEqual((await imports.pending()).items,[]);
 for(const source of [root,child,grand]){
  const restored=new ProjectStorage(path.join(imported.project.root,path.relative(root.root,source.root)),source.projectId,source.vault);assert.deepEqual(await restored.read(),snapshots.get(source.root));const registered=await receiverRegistry.locate(source.projectId);assert.equal(registered.root,restored.root);assert.equal(registered.parentId,source===root?containerId:source===child?root.projectId:child.projectId);
  for(const entry of (await new LabBookRegistry(restored).read()).value.books){const bookSource=books.get(entry.labBookId),restoredBook=new LabBookStorage(path.join(restored.root,entry.directory),entry.labBookId,bookSource.vault);assert.deepEqual(await restoredBook.read(),snapshots.get(bookSource.root));assert.equal(await restoredBook.readFile(path.join(restoredBook.root,'.observanda/evidence.bin'),'utf8'),'Evidence for '+entry.directory);assert.equal((await new LabBookDirectory(receiverRegistry).locate(entry.namespaceId)).projectId,source.projectId);}
 }

 await assert.rejects(imports.cancel({id:importId,username:'',password,recovery:'',owners:request.owners}),{code:'CONFLICT'});
 const restoredStorage=new ProjectStorage(imported.project.root,root.projectId,root.vault),restoredTree=await readProjectTree(restoredStorage),restoredRows=[];for await(const row of projectTreeCollection(restoredStorage,restoredTree).entries())if(row.relative)restoredRows.push(row);assert.deepEqual(restoredRows,treeRows);
 const laterGrant=await grant(),laterData=createNotebook('Later Child'),laterId=randomUUID();laterData.projects=[{id:laterId,title:laterData.title,parentId:null,description:'',share:false,logoId:null}];const later=await initializeProjectLocation(path.join(imported.project.root,laterData.title),laterId,laterData,laterGrant.access,laterGrant.vault);await receiverRegistry.attach(later,{parentId:root.projectId,expected:await receiverRegistry.version()});
 const inspectLater=new ProjectImportInventory(device,[...supplied,{relative:'Later Child',username:'',password,recovery:''}]);try{assert.equal((await inspectLater.inspect(imported.project.root)).manifest.projects.length,3);}finally{inspectLater.close();}
 await imports.run({id:importId,username:'',password,recovery:'',owners:request.owners},{resume:true});assert.equal((await receiverRegistry.locate(laterId)).root,later.root);

});
