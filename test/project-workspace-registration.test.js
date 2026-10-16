import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {rename} from 'node:fs/promises';
import {projectTreeFixture} from './project-tree-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {admitWorkspaceProjectTree,publishWorkspaceProjectTree} from '../src/project-workspace-move-registration.js';
import {recordProjectDeparture} from '../src/project-relocation-directory.js';

test('destination tree registration resumes between membership and book addresses, then accepts a verified return identity',async t=>{
 const f=await projectTreeFixture(t),destinationMetadata=createNotebook('Destination Workspace'),destinationFixture=await encryptedFixture(path.join(f.directory,'destination'),destinationMetadata);t.after(()=>clearVault(destinationFixture.vault));
 const destination=new ProjectRegistry(destinationFixture.workspace,destinationMetadata.id),entries=(await f.registry.read()).value.projects,root=f.projects[0],destinationRoot=path.join(destinationFixture.workspace.root,path.basename(root.root));
 const value={id:randomUUID(),workspaceId:f.registry.workspaceId,projectId:root.projectId,namespaceId:root.namespaceId,vaultId:root.vaultId,placement:{parentId:null,expectedParentId:null},rootBooks:{books:f.books.filter(book=>book.projectId===root.projectId)},projects:f.projects.slice(1).map(project=>({...project,books:f.books.filter(book=>book.projectId===project.projectId)})),entries:entries.map(({root:folder,...entry})=>({...entry,relative:path.relative(root.root,folder).split(path.sep).join('/')}))};
 await admitWorkspaceProjectTree(destination,value,destinationRoot,{fresh:true});
 const duplicate=structuredClone(value);duplicate.projects[0].books[0].namespaceId=duplicate.rootBooks.books[0].namespaceId;await assert.rejects(admitWorkspaceProjectTree(destination,duplicate,destinationRoot,{fresh:true}),{code:'DATABASE_LOCATION'});
 // This fixture relocates stopped disposable owners; it exercises membership
 // publication only, not the separate move engine or source retirement.
 await f.stopProvider();await rename(root.root,destinationRoot);f.restartProvider();
 const owners=f.projects.map(project=>({kind:'project',ownerId:project.projectId,storage:new ProjectStorage(path.join(destinationRoot,path.relative(root.root,project.root)),project.projectId,project.key)})),transfer={command:{scope:()=>({destination:destinationRoot})},using:async(_root,operation)=>operation(owners)};
 await assert.rejects(publishWorkspaceProjectTree(destination,value,transfer,{checkpoint:async stage=>{if(stage==='destination-registry')throw Error('Interrupted registry acknowledgement');}}),/Interrupted registry acknowledgement/);
 assert.equal((await destination.read()).value.projects.length,2);assert.equal(await new LabBookDirectory(destination).read(f.books[0].namespaceId),null);
 await publishWorkspaceProjectTree(destination,value,transfer);const complete=await destination.read();await publishWorkspaceProjectTree(destination,value,transfer);assert.equal((await destination.read()).revision,complete.revision);
 await assert.rejects(admitWorkspaceProjectTree(destination,value,destinationRoot,{fresh:true}),{code:'PROJECT_LOCATION_EXISTS'});
 for(const book of f.books){assert.equal((await new LabBookDirectory(destination).locate(book.namespaceId)).projectId,book.projectId);assert.deepEqual(await new LabBookStorage(path.join(destinationRoot,path.relative(root.root,book.root)),book.labBookId,book.key).read(),book.before);}
 await recordProjectDeparture(f.registry,entries,{workspaceId:destination.workspaceId,operationId:value.id});
 await recordProjectDeparture(destination,complete.value.projects,{workspaceId:f.registry.workspaceId,operationId:randomUUID()});
 await admitWorkspaceProjectTree(destination,value,destinationRoot,{fresh:true});await publishWorkspaceProjectTree(destination,value,transfer);assert.deepEqual((await destination.read()).value.relocated,[]);
});
