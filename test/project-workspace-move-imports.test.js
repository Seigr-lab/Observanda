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
import {readAccess,verifyAccess} from '../src/access.js';
import {workspaceRename} from '../src/workspace-rename-state.js';

test('paused project imports and moves hold their projects against each other',{timeout:360000},async t=>{
 const f=await projectTreeFixture(t),metadata=createNotebook('Receiving Workspace'),target=await encryptedFixture(path.join(f.directory,metadata.title),metadata);t.after(()=>clearVault(target.vault));
 // The held second project moves to a third workspace once its import is cancelled.
 const moveMetadata=createNotebook('Moving Workspace'),moveTarget=await encryptedFixture(path.join(f.directory,moveMetadata.title),moveMetadata);t.after(()=>clearVault(moveTarget.vault));const moveRegistry=new ProjectRegistry(moveTarget.workspace,moveMetadata.id);
 const registry=new ProjectRegistry(target.workspace,metadata.id),creation=new ProjectCreation(registry,f.deviceStore),parent=await destinationProject({...f,creation},t),parentStorage=new ProjectStorage(parent.root,parent.projectId,parent.key),source=f.projects[0],storage=new ProjectStorage(source.root,source.projectId,source.key),moves=new ProjectWorkspaceMoves(f.registry,registry,source.projectId),imports=new ProjectImports(registry,f.deviceStore);
 const credentials={username:'',password:'',recovery:'',owners:f.books.map(book=>({relative:path.relative(source.root,book.root).split(path.sep).join('/'),username:'',password:'Protected observations 456!',recovery:''}))},importId=randomUUID();
 const options={id:randomUUID(),parentId:null,expectedParentId:null,withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(project=>project.projectId===id).key)),withBook:async(project,id,use)=>use(new LabBookStorage((await new LabBookRegistry(project).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 // A paused import holds its source tree, also when that project belongs to another workspace: the project cannot
 // be moved away until the import completes or is cancelled, and cancelling releases it.
 const otherId=randomUUID(),created=(await f.creation.create({id:randomUUID(),username:'',password:'',project:{id:otherId,title:'Second Source Project',description:'',parentId:null,share:false,logoId:null}})).project,otherKey=await verifyAccess(await readAccess(created.root),'','',{deviceStore:f.deviceStore});t.after(()=>clearVault(otherKey));
 const other={...created,key:otherKey},otherStorage=new ProjectStorage(other.root,other.projectId,other.key),otherMoves=new ProjectWorkspaceMoves(f.registry,moveRegistry,other.projectId),otherImport=randomUUID(),none={username:'',password:'',recovery:'',owners:[]};
 const otherOptions={...options,id:randomUUID(),withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,other.key))};
 await assert.rejects(imports.run({id:otherImport,path:other.root,parentId:null,...none},{checkpoint:stage=>{if(stage==='prepared')throw Error('Paused import');}}),/Paused import/);
 await assert.rejects(otherMoves.run(otherStorage,otherOptions),{code:'STORAGE_PROJECT_BUSY'});assert.equal((await f.registry.locate(other.projectId)).root,other.root);
 assert.equal((await imports.cancel({id:otherImport,...none})).cancelled,true);await assert.rejects(stat(path.join(target.workspace.root,path.basename(other.root))),{code:'ENOENT'});
 assert.equal((await otherMoves.run(otherStorage,{...otherOptions,id:randomUUID()})).complete,true);
 await assert.rejects(moves.run(storage,{...options,checkpoint:stage=>{if(stage==='prepared')throw Error('Paused move');}}),/Paused move/);
 await assert.rejects(imports.run({id:randomUUID(),path:source.root,parentId:null,...credentials}),{code:'STORAGE_PROJECT_BUSY'});
 const selected=f.books[0],bookImports=new LabBookImports(parentStorage,registry,f.deviceStore);
 await assert.rejects(bookImports.run({id:randomUUID(),path:selected.root,username:'',password:'Protected observations 456!',recovery:''}),{code:'STORAGE_PROJECT_BUSY'});
 await assert.rejects(stat(path.join(parent.root,path.basename(selected.root))),{code:'ENOENT'});
 await parentStorage.update(value=>{value.projects[0].description='Unrelated owner remains writable';return value;});
 assert.equal((await moves.run(storage,options)).complete,true);
 for(const book of f.books){const root=path.join(target.workspace.root,path.basename(source.root),path.relative(source.root,book.root));assert.deepEqual(await new LabBookStorage(root,book.labBookId,book.key).read(),book.before);}
});
