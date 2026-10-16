import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rename,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID as id} from 'node:crypto';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectImports} from '../src/project-import.js';
import {LabBookImports} from '../src/lab-book-import.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {privateDirectory,digest,serialize} from '../src/storage.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {ProjectApplication} from '../src/project-application.js';
import {projectPublicationSource,publicationSourceFactory} from '../src/project-publication-sources.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {emptyPublicationSource} from '../src/web/publication-sources-model.js';
import {contentBuffer} from '../src/file-content.js';

test('websites reopen selected projects and books imported into different workspaces without their original folders',{timeout:300000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-imports-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:id(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let application;
 try{
  const origin=await encryptedFixture(path.join(directory,'Original'),createNotebook('workspace'));keys.push(origin.vault);const device=origin.deviceStore,registry=new ProjectRegistry(origin.workspace,(await origin.workspace.outline()).metadata.id);
  async function project(workspace,registry,title){
   const metadata=createNotebook(title),projectId=id();metadata.projects=[{id:projectId,title,description:'',share:false,logoId:null}];
   const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);
   const storage=await initializeProjectLocation(path.join(workspace.root,title),projectId,metadata,access,vault);await registry.attach(storage,{expected:(await registry.read()).revision});return storage;
  }
  const originalProject=await project(origin.workspace,registry,'Field project'),entry=(await new LabBookCreation(originalProject,device,{publish:book=>new LabBookDirectory(registry).register(originalProject.projectId,book)}).create({id:id(),username:'',password:'',book:{id:id(),projectId:originalProject.projectId,title:'Observations \u00c5 1'}})).book;
  const key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});keys.push(key);const originalBook=new LabBookStorage(entry.root,entry.labBookId,key),png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
  const attachments=[true,false].map(share=>({id:id(),kind:'image',caption:share?'Selected image':'Private image',alt:'Observation image',share,transcript:''}));
  for(const asset of attachments){const folder=await privateDirectory(originalBook.root,'.observanda/media/'+asset.id),metadata={id:asset.id,kind:'image',extension:'png',mime:'image/png',bytes:png.length,sha256:digest(png),originalBytes:png.length,originalSha256:digest(png)};await originalBook.writeFile(path.join(folder,'asset.json'),serialize(metadata));await originalBook.writeFile(path.join(folder,'public.png'),png);await originalBook.writeFile(path.join(folder,'original'),png);}
  const records=[0,1].map(index=>({...structuredClone(sampleNotebook().entries[0]),id:id(),notebookId:entry.labBookId,title:index?'Excluded record':'Selected record',body:index?'WITHHELD_RECORD':'Selected original evidence',share:true,attachments:index?[]:attachments,figures:[],relations:[],sections:[]}));
  await new ResearchRecords(originalBook,new MediaStore(originalBook)).save({workspaceId:entry.namespaceId,changes:records.map(record=>({id:record.id,expectedRevision:null,record}))});
  const source=emptyPublicationSource(entry.namespaceId,entry.labBookId);source.projectIds=[originalProject.projectId];source.selection.includeProjects=[originalProject.projectId];source.selection.records=[{id:records[1].id,share:false,attachments:[]}];
  const command=(workspaceId,operation='pages')=>({workspaceId,sourceId:source.workspaceId,operation,query:{workspaceId:source.workspaceId,snapshotId:null,source,search:'',cursor:null,backward:false}});
  application=new ProjectApplication(origin.workspace,{deviceStore:device});const before=await projectPublicationSource(application,{},command(registry.workspaceId)),originalPage=before.value.items[0];assert.equal(before.value.items.length,1);await application.close();application=null;
  const destinations=[];
  for(const mode of ['project','book']){
   const fixture=await encryptedFixture(path.join(directory,mode),createNotebook('workspace'));keys.push(fixture.vault);const host=(await fixture.workspace.outline()).metadata.id,targetRegistry=new ProjectRegistry(fixture.workspace,host),sites=new WebsiteSites(fixture.workspace),created=await sites.change({workspaceId:host,etag:(await fixture.workspace.outline()).etag,operation:'create',name:'Independent journal'}),site=await sites.read(created.id);
   await sites.save(created.id,{workspaceId:host,baseEtag:site.etag,metadata:{website:{...site.book.website,researchSources:[source],footer:'Independent journal'}},projects:[],changes:[],removed:[],selection:site.site.selection});
   application=new ProjectApplication(fixture.workspace,{deviceStore:device});await assert.rejects(projectPublicationSource(application,{},command(host)),{code:'NOT_FOUND'});await application.close();application=null;
   let projectId;
   if(mode==='project'){await new ProjectImports(targetRegistry,device).run({id:id(),path:originalProject.root,username:'',password:'',recovery:''});projectId=originalProject.projectId;}
   else{const parent=await project(fixture.workspace,targetRegistry,'Receiving project');projectId=parent.projectId;await new LabBookImports(parent,targetRegistry,device).run({id:id(),path:originalBook.root,username:'',password:'',recovery:''});}
   const located=await new LabBookDirectory(targetRegistry).locate(source.workspaceId);assert.equal(located.projectId,projectId);assert.equal(located.labBookId,entry.labBookId);destinations.push({fixture,host,projectId,siteId:created.id});
  }
  await runtime.closeLabBook(originalBook.root);await runtime.closeProject(originalProject.root);await runtime.closeWorkspace(origin.workspace.root);assert.equal(path.dirname(origin.workspace.root),path.join(directory,'Original'));await rename(origin.workspace.root,path.join(directory,'Original','Source unavailable'));
  for(const target of destinations)await t.test('publish after independent '+(target.projectId===originalProject.projectId?'project':'book')+' import',async()=>{
   application=new ProjectApplication(target.fixture.workspace,{deviceStore:device});const client={},pages=await projectPublicationSource(application,client,command(target.host)),media=await projectPublicationSource(application,client,command(target.host,'source-media'));
   assert.equal(pages.owner.projectId,target.projectId);assert.equal(pages.value.items.length,1);assert.equal(pages.value.items[0].path,originalPage.path);assert.equal(pages.value.items[0].target,originalPage.target);assert.equal(media.value.items.length,1);assert.equal(media.value.items[0].sourceAttachmentId,attachments[0].id);
   const owned=websiteWorkspace(target.fixture.workspace,target.siteId),sourceReader=publicationSourceFactory(application,client,owned),edition=await new PublicationJobs(owned,{sourceReader}).inline({etag:(await owned.outline()).etag});
   assert.equal(edition.entries.length,1);const html=(await contentBuffer(edition.files.get(originalPage.path))).toString();assert.match(html,/Selected original evidence/);assert.doesNotMatch(html,/WITHHELD_RECORD|Private image/);assert.deepEqual(await contentBuffer(edition.files.get('media/'+media.value.items[0].asset.id+'.png')),png);
   assert.deepEqual((await owned.outline()).metadata.website.researchSources,[source]);await application.close();application=null;
  });
 }finally{await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-publication-imports-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
