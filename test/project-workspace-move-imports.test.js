import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture,destinationProject} from './project-tree-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookImports} from '../src/lab-book-import.js';
import {ProjectImports} from '../src/project-import.js';
import {ProjectWorkspaceMoves} from '../src/project-workspace-move.js';
import {clearVault} from '../src/encryption.js';
import {workspaceRename} from '../src/workspace-rename-state.js';

test('paused project imports and workspace moves cannot claim the same owners in different destination parents',{timeout:360000},async t=>{
 const f=await projectTreeFixture(t),metadata=createNotebook('Receiving Workspace'),target=await encryptedFixture(path.join(f.directory,metadata.title),metadata);t.after(()=>clearVault(target.vault));
 const registry=new ProjectRegistry(target.workspace,metadata.id),creation=new ProjectCreation(registry,f.deviceStore),parent=await destinationProject({...f,creation},t),parentStorage=new ProjectStorage(parent.root,parent.projectId,parent.key),source=f.projects[0],storage=new ProjectStorage(source.root,source.projectId,source.key),moves=new ProjectWorkspaceMoves(f.registry,registry,source.projectId),imports=new ProjectImports(registry,f.deviceStore);
 const credentials={username:'',password:'',recovery:'',owners:f.books.map(book=>({relative:path.relative(source.root,book.root).split(path.sep).join('/'),username:'',password:'Protected observations 456!',recovery:''}))},importId=randomUUID();
 await assert.rejects(imports.run({id:importId,path:source.root,parentId:parent.projectId,...credentials},{checkpoint:stage=>{if(stage==='prepared')throw Error('Paused import');}}),/Paused import/);
 const options={id:randomUUID(),parentId:null,expectedParentId:null,withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(project=>project.projectId===id).key)),withBook:async(project,id,use)=>use(new LabBookStorage((await new LabBookRegistry(project).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 await assert.rejects(moves.run(storage,options),{code:'STORAGE_PROJECT_BUSY'});assert.equal(await workspaceRename(source.root),null);await assert.rejects(stat(path.join(target.workspace.root,path.basename(source.root))),{code:'ENOENT'});
 await imports.cancel({id:importId,...credentials});
 await assert.rejects(moves.run(storage,{...options,checkpoint:stage=>{if(stage==='prepared')throw Error('Paused move');}}),/Paused move/);
 await assert.rejects(imports.run({id:randomUUID(),path:source.root,parentId:parent.projectId,...credentials}),{code:'STORAGE_PROJECT_BUSY'});
 const selected=f.books[0],bookImports=new LabBookImports(parentStorage,registry,f.deviceStore);
 await assert.rejects(bookImports.run({id:randomUUID(),path:selected.root,username:'',password:'Protected observations 456!',recovery:''}),{code:'STORAGE_PROJECT_BUSY'});
 await assert.rejects(stat(path.join(parent.root,path.basename(selected.root))),{code:'ENOENT'});
 await parentStorage.update(value=>{value.projects[0].description='Unrelated owner remains writable';return value;});
 assert.equal((await moves.run(storage,options)).complete,true);
 for(const book of f.books){const root=path.join(target.workspace.root,path.basename(source.root),path.relative(source.root,book.root));assert.deepEqual(await new LabBookStorage(root,book.labBookId,book.key).read(),book.before);}
});
