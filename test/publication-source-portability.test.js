import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename,rm} from 'node:fs/promises';
import {Workspace} from '../src/storage.js';
import {WorkspaceProjectCopy} from '../src/workspace-project-copy.js';
import path from 'node:path';
import os from 'node:os';
import {randomUUID as id} from 'node:crypto';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookReparents} from '../src/lab-book-reparent.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {ProjectApplication} from '../src/project-application.js';
import {projectPublicationSource,publicationSourceFactory} from '../src/project-publication-sources.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {WebsiteSites} from '../src/website-sites.js';
import {emptyPublicationSource} from '../src/web/publication-sources-model.js';
import {contentBuffer} from '../src/file-content.js';

test('a website retains its selected book and page identity after project reassignment and a workspace copy with the source offline',{timeout:300000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-portable-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:id(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let application;
 try{
  const host=createNotebook('Publishing workspace'),fixture=await encryptedFixture(directory,host);keys.push(fixture.vault);const registry=new ProjectRegistry(fixture.workspace,host.id),addresses=new LabBookDirectory(registry),projects=[],books=[];
  for(const label of ['First','Second']){
   const metadata=createNotebook(label+' project'),projectId=id();metadata.projects=[{id:projectId,title:metadata.title,description:'',share:false,logoId:null}];
   const access=await createWorkspaceAccess('','',fixture.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
   const project=await initializeProjectLocation(path.join(fixture.workspace.root,metadata.title),projectId,metadata,access,vault);await registry.attach(project,{expected:(await registry.read()).revision});projects.push(project);
   const entry=(await new LabBookCreation(project,fixture.deviceStore,{publish:entry=>addresses.register(projectId,entry)}).create({id:id(),username:'',password:'',book:{id:id(),projectId,title:label+' observations'}})).book,key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:fixture.deviceStore});keys.push(key);
   const storage=new LabBookStorage(entry.root,entry.labBookId,key),records=[0,1].map(index=>({...structuredClone(sampleNotebook().entries[0]),id:id(),notebookId:entry.labBookId,title:label+' observation '+index,body:label+' evidence '+index,share:true,attachments:[],figures:[],relations:[],sections:[]}));
   await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:entry.namespaceId,changes:records.map(record=>({id:record.id,expectedRevision:null,record}))});books.push({entry,storage,records,before:await storage.read()});
  }
  const source=emptyPublicationSource(books[0].entry.namespaceId,books[0].entry.labBookId);source.projectIds=[projects[0].projectId];source.selection.includeProjects=[projects[0].projectId];source.selection.records=[{id:books[0].records[1].id,share:false,attachments:[]}];
  const sites=new WebsiteSites(fixture.workspace),site=await sites.read(null);
  await sites.save(null,{workspaceId:host.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{website:{...site.book.website,researchSources:[source]}},projects:[],changes:[],removed:[],selection:site.site.selection});
  const client={},command={workspaceId:host.id,sourceId:source.workspaceId,operation:'pages',query:{workspaceId:source.workspaceId,snapshotId:null,source,search:'',cursor:null,backward:false}};
  application=new ProjectApplication(fixture.workspace,{deviceStore:fixture.deviceStore});const before=await projectPublicationSource(application,client,command);assert.equal(before.value.items.length,1);const page=before.value.items[0];
  await application.close();application=null;
  const moved=await new LabBookReparents(registry,books[0].entry.labBookId).run(projects[0],projects[1],books[0].storage.vault,{id:id()});assert.equal(moved.complete,true);books[0].storage=new LabBookStorage(moved.book.root,moved.book.labBookId,books[0].storage.vault);
  application=new ProjectApplication(fixture.workspace,{deviceStore:fixture.deviceStore});const after=await projectPublicationSource(application,client,command);assert.equal(after.owner.projectId,projects[1].projectId);assert.equal(after.value.items.length,1);assert.equal(after.value.items[0].path,page.path);assert.equal(after.value.items[0].target,page.target);
  const sources=(await sites.read(null)).book.website.researchSources;assert.deepEqual(sources,[source]);assert.deepEqual((await books[0].storage.read()).book.entries,books[0].before.book.entries);assert.deepEqual(await books[1].storage.read(),books[1].before);
  const sourceReader=publicationSourceFactory(application,client,fixture.workspace),releases=new PublicationJobs(fixture.workspace,{sourceReader}),edition=await releases.inline(await releases.workspace.outline());assert.equal(edition.files.output.count('entries'),1);assert.equal((await edition.files.output.get('entries',page.record.id)).id,page.record.id);
  const html=(await contentBuffer(await edition.files.get(page.path))).toString();assert.match(html,/First evidence 0/);assert.doesNotMatch(html,/First evidence 1|Second evidence/);assert.deepEqual((await books[0].storage.read()).book.entries,books[0].before.book.entries);
  await application.close();application=null;
  const parent=path.join(directory,'Copy destination');await mkdir(parent);const destination=path.join(parent,path.basename(fixture.workspace.root)),copy=new WorkspaceProjectCopy(fixture.workspace,{withProject:(projectId,use)=>use(projects.find(project=>project.projectId===projectId)),withBook:(_project,bookId,use)=>use(books.find(book=>book.storage.labBookId===bookId).storage)});
  await copy.copy(await copy.plan(destination,{inspect:false}));for(const book of books)await runtime.closeLabBook(book.storage.root);for(const project of projects)await runtime.closeProject(project.root);await runtime.closeWorkspace(fixture.workspace.root);assert.equal(path.dirname(fixture.workspace.root),directory);await rename(fixture.workspace.root,path.join(directory,'Source unavailable'));
  const copied=new Workspace(destination,fixture.vault);application=new ProjectApplication(copied,{deviceStore:fixture.deviceStore});const copiedClient={},copiedPage=await projectPublicationSource(application,copiedClient,command);assert.equal(copiedPage.value.items[0].path,page.path);assert.equal(copiedPage.value.items.length,1);assert.deepEqual((await new WebsiteSites(copied).read(null)).book.website.researchSources,[source]);
  const copiedReleases=new PublicationJobs(copied,{sourceReader:publicationSourceFactory(application,copiedClient,copied)}),copiedEdition=await copiedReleases.inline(await copiedReleases.workspace.outline()),copiedHtml=(await contentBuffer(await copiedEdition.files.get(page.path))).toString();assert.equal(copiedEdition.files.output.count('entries'),1);assert.match(copiedHtml,/First evidence 0/);assert.doesNotMatch(copiedHtml,/First evidence 1|Second evidence/);

 }finally{await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-publication-portable-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
