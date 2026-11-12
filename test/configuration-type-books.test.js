import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {starterTemplate} from '../src/web/project-templates.js';
import {emptyConfiguration} from '../src/web/notebook-schema.js';

// Preferences lists the lab books that use a lab-book type across the workspace and its project and
// lab book stores (configuration-type-settings.js), through the workspace's structural collection.
test('lab books using a type are listed across project and lab book stores in pages without record bodies',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-type-books-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let application;const original=ResearchCatalogue.prototype.record;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);const registry=new ProjectRegistry(f.workspace,root.id);
  const create=async name=>{const book=sampleNotebook();book.title=book.projects[0].title=name;const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);const storage=await initializeProjectLocation(path.join(f.workspace.root,name),book.projects[0].id,book,access,vault);await registry.attach(storage,{expected:(await registry.read()).revision,parentId:null});return {book,storage};};
  const apiary=await create('Apiary project'),other=await create('Other project');
  const book=async(project,title,configuration)=>{
   const created=await new LabBookCreation(project.storage,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(project.storage.projectId,entry)}).create({id:randomUUID(),username:'',password:'Book password',book:{id:randomUUID(),projectId:project.storage.projectId,title,configuration}});
   keys.push(await verifyAccess(await readAccess(created.book.root),'','Book password',{deviceStore:f.deviceStore}));return created.book;
  };
  const hives=await book(apiary,'Hive book',starterTemplate('beekeeping').configuration),plain=await book(other,'Plain book',emptyConfiguration()),colonies=await book(other,'Colony book',starterTemplate('beekeeping').configuration);
  application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});const client={};
  for(const [project,labBook] of [[apiary,hives],[other,plain],[other,colonies]])await application.run(client,projectRequest('/api/projects/'+project.storage.projectId+'/lab-books/'+labBook.labBookId+'/access/unlock','POST'),{password:'Book password'});
  ResearchCatalogue.prototype.record=()=>{throw Error('Listing lab books loaded a record body');};
  const command={workspaceId:root.id,etag:await f.workspace.catalogue(store=>store.head()),provider:'laboratory-beekeeping-spaces',config:defaultPanelConfig(),options:{},limit:1,key:null,cursor:null};
  const read=data=>application.run(client,projectRequest('/api/projects/dashboard-collection/structure','POST'),{...command,...data});
  const items=[];let page=await read();assert.equal(page.total,2);items.push(...page.items);
  while(page.nextCursor){page=await read({cursor:page.nextCursor});items.push(...page.items);}
  assert.deepEqual(items.map(item=>item.title).sort(),['Colony book','Hive book']);
  const owners=Object.fromEntries(items.map(item=>[item.title,item.owner]));
  assert.equal(owners['Hive book'].projectId,apiary.storage.projectId);assert.equal(owners['Hive book'].labBookId,hives.labBookId);
  assert.equal(owners['Colony book'].projectId,other.storage.projectId);assert.equal(owners['Colony book'].labBookId,colonies.labBookId);
  assert.ok(items.every(item=>item.data.profiles.includes('beekeeping')&&item.key===item.owner.workspaceId+'/'+item.data.id));
 }finally{ResearchCatalogue.prototype.record=original;await application?.close();await runtime.close();detach();await Promise.all(keys.map(clearVault));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
