import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,rename,stat,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {TestDeviceStore} from './device-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectBookOwners} from '../src/project-book-owners.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookImports} from '../src/lab-book-import.js';
import {copyLabBookLocation} from '../src/lab-book-transfer.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {RecordWriting} from '../src/record-writing.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {MediaStore} from '../src/media.js';
import {resolveResearchReference} from '../src/research-owner-reference.js';

test('selected book import restores once at its nested destination and resumes without its source',{timeout:480000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-import-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[];
 t.after(async()=>{await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-import-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')});
 async function credentials(){const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};}
 async function workspace(title){const metadata=createNotebook(title),key=await credentials(),root=path.join(directory,title);await initializeLocation(root,metadata,key.access,key.vault);const storage=new Workspace(root,key.vault);return {storage,registry:new ProjectRegistry(storage,metadata.id)};}
 async function project(owner,title){const metadata=createNotebook(title),id=randomUUID(),key=await credentials();metadata.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const storage=await initializeProjectLocation(path.join(owner.storage.root,title),id,metadata,key.access,key.vault);await owner.registry.attach(storage,{expected:(await owner.registry.read()).revision});return storage;}
 const original=await workspace('Original Workspace'),destination=await workspace('Destination Workspace'),sourceProject=await project(original,'Source Project'),targetProject=await project(destination,'Target Project'),sibling=await project(destination,'Sibling Project');
 async function book(title){const created=await new LabBookCreation(sourceProject,device,{publish:entry=>new LabBookDirectory(original.registry).register(sourceProject.projectId,entry)}).create({id:randomUUID(),username:'',password:'Portable book password',book:{id:randomUUID(),projectId:sourceProject.projectId,title}}),vault=await verifyAccess(await readAccess(created.book.root),'','Portable book password',{deviceStore:device});keys.push(vault);return new LabBookStorage(created.book.root,created.book.labBookId,vault);}
 const source=await book('\u00c5ngstr\u00f6m Notes 1'),outline=await source.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:source.labBookId};await new ResearchRecords(source,new MediaStore(source)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
 const initial=await source.read(),old=initial.book.entries[0],reference={workspaceId:outline.metadata.id,kind:'record',id:record.id,revision:recordRevision(old)},target={workspaceId:outline.metadata.id,recordId:record.id,sectionId:null},writing=new RecordWriting(source),first=await writing.read(target);await writing.save({...target,expectedRevision:first.revision,value:{body:'Latest observation'}});
 const materials=new ResearchMaterials(source),bytes=Buffer.from('Independent retained evidence'),upload=await materials.startImport({recordId:record.id,name:'evidence.txt',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const evidence=await materials.finishImport(upload.id),backups=path.join(directory,'Backups');await mkdir(backups);const backup=path.join(backups,path.basename(source.root));await copyLabBookLocation(source,backup,{id:randomUUID(),portable:true});assert.equal(await catalogueBinding(backup),null);
 const command=new LabBookImports(targetProject,destination.registry,device),id=randomUUID(),request={id,path:backup,username:'',password:'Portable book password',recovery:''},next={id,username:'',password:'Portable book password',recovery:''};
 await assert.rejects(command.run({...request,password:'Wrong password'}),{code:'LAB_BOOK_IMPORT_ACCESS'});assert.equal(await command.read(id),null);
 const missing=path.join(backups,'Source unavailable');let renamed=false;
 for(const stage of ['prepared','file','copied','restored','parent','attached','addressed','complete']){
  let reached=false;await assert.rejects(command.run(stage==='prepared'?request:next,{resume:stage!=='prepared',checkpoint:point=>{if(point===stage&&!reached){reached=true;throw Error('Interrupted '+stage);}}}),new RegExp('Interrupted '+stage));assert.ok(reached);
  await assert.rejects(new ProjectBookOwners(targetProject).ready(),{code:'LAB_BOOK_IMPORT_PENDING'});
  assert.ok((await command.pending()).items.some(item=>item.id===id));
  const metadata=(await sibling.read()).book;metadata.description='Independent work during '+stage;await sibling.save(metadata,(await sibling.read()).etag);
  if(stage==='copied'){await assert.rejects(stat(path.join(backup,'.observanda/postgresql')),{code:'ENOENT'});await rename(backup,missing);renamed=true;}
  t.diagnostic('Import recovered through '+stage);
 }
 assert.ok(renamed);const completed=await command.run(next,{resume:true});assert.equal(completed.complete,true);await assert.rejects(command.cancel(next),{code:'CONFLICT'});assert.equal(completed.book.root,path.join(targetProject.root,path.basename(source.root)));assert.equal((await command.pending()).items.length,0);await new ProjectBookOwners(targetProject).ready();
 const imported=new LabBookStorage(completed.book.root,source.labBookId,source.vault),read=await imported.read();assert.equal(read.book.id,initial.book.id);assert.equal(read.book.projects[0].id,targetProject.projectId);assert.equal(read.book.notebooks[0].projectId,targetProject.projectId);assert.equal(read.book.entries[0].body,'Latest observation');assert.equal((await resolveResearchReference(imported,reference)).value.body,old.body);assert.equal((await destination.registry.reference(reference)).projectId,targetProject.projectId);
 await new ResearchMaterials(imported).artifact(evidence);const current=await new RecordWriting(imported).read(target);await new RecordWriting(imported).save({...target,expectedRevision:current.revision,value:{body:'Written after import'}});await command.run(next,{resume:true});assert.equal((await imported.read()).book.entries[0].body,'Written after import');
 await rename(missing,backup);await assert.rejects(new LabBookImports(sibling,destination.registry,device).run({...request,id:randomUUID()}),{code:'DATABASE_LOCATION'});await assert.rejects(stat(path.join(sibling.root,path.basename(source.root))),{code:'ENOENT'});
 // A portable owner already placed under its chosen project is adopted there.
 const nested=await book('Nested Notes 2'),nestedRoot=path.join(targetProject.root,path.basename(nested.root));await copyLabBookLocation(nested,nestedRoot,{id:randomUUID(),portable:true});const before=await stat(nestedRoot),nestedImport=await command.run({...request,id:randomUUID(),path:nestedRoot});assert.equal(nestedImport.book.root,nestedRoot);assert.equal((await stat(nestedRoot)).ino,before.ino);assert.equal((await new LabBookRegistry(targetProject).locate(nested.labBookId)).root,nestedRoot);
 // A copied native owner uses its own transfer, then opens in the selected project.
 const native=await book('Native Notes 3'),nativeRoot=path.join(backups,path.basename(native.root));await copyLabBookLocation(native,nativeRoot,{id:randomUUID()});await provider.closeLabBook(nativeRoot);
 const nativeImport=await command.run({...request,id:randomUUID(),path:nativeRoot});assert.equal(nativeImport.book.namespaceId,(await native.outline()).metadata.id);assert.equal((await new LabBookStorage(nativeImport.book.root,native.labBookId,native.vault).read()).book.notebooks[0].projectId,targetProject.projectId);
 // Corrupt source bytes never publish a book, and correcting the archive permits retry.
 const repairable=await book('Repairable Backup'),repairRoot=path.join(backups,path.basename(repairable.root));await copyLabBookLocation(repairable,repairRoot,{id:randomUUID(),portable:true});const archive=path.join(repairRoot,'.observanda/research-archive.observanda'),bytesBefore=await readFile(archive);await writeFile(archive,Buffer.concat([bytesBefore,Buffer.from([127])]));const repairRequest={...request,id:randomUUID(),path:repairRoot};
 await assert.rejects(command.run(repairRequest),{code:'STORAGE_COPY'});await assert.rejects(new LabBookRegistry(targetProject).locate(repairable.labBookId),{code:'NOT_FOUND'});assert.equal((await command.read(repairRequest.id)).phase,'prepared');
 await writeFile(archive,bytesBefore);assert.equal((await command.run(repairRequest)).complete,true);
 assert.equal((await source.read()).book.entries[0].body,'Latest observation');assert.equal(await catalogueBinding(backup),null);
});
