import {recoveryKey} from '../../src/security/keyring.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from '../../src/postgres-activation.js';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation,ProjectStorage} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {Workspace,atomicWrite,serialize} from '../../src/storage.js';
import {preferences} from './preferences-helper.js';

test('set independent project passwords and export a complete portable workspace from one action',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-portable-owners-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app;
 try{
  const book=sampleNotebook(),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,book.id),projects=[];
  for(const root of [path.join(directory,'External Project'),path.join(f.workspace.root,'.observanda','Nested Project')]){const research=sampleNotebook(),keys=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(keys);vaults.push(vault);research.title=research.projects[0].title=path.basename(root);const storage=await initializeProjectLocation(root,research.projects[0].id,research,keys,vault);await registry.attach(storage,{expected:(await registry.read()).revision});projects.push(storage);}
  const kit=recoveryKey((await readAccess(f.workspace.root)).value,f.vault);await atomicWrite(path.join(f.workspace.root,'.observanda/access.json'),serialize(kit.value));
  app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')});await page.goto(app.url);
  for(const project of projects){await page.goto(app.origin+'/#/owners/'+project.projectId+'/projects/'+project.projectId);const section=page.locator('[data-project-access="'+project.projectId+'"]');await expect(section.getByRole('heading',{name:'Project access'})).toBeVisible();await section.getByLabel('Project password',{exact:true}).fill('Portable project password');await section.getByLabel('Confirm project password',{exact:true}).fill('Different project password');await section.getByRole('button',{name:'Save project password'}).click();expect(await section.getByLabel('Confirm project password',{exact:true}).evaluate(input=>input.validity.customError)).toBe(true);await section.getByLabel('Confirm project password',{exact:true}).fill('Portable project password');await section.getByRole('button',{name:'Save project password'}).click();await expect(section).toContainText('Project password saved.');await expect(page.locator('#project-unlock-form')).toHaveCount(0);}
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Create portable workspace copy',exact:true}).click();const dialog=page.locator('#dialog'),destination=path.join(directory,'Portable Workspace 1');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);await dialog.getByText('Use a recovery key',{exact:true}).click();await dialog.getByLabel('Recovery key',{exact:true}).fill(kit.recovery);await dialog.getByRole('button',{name:'Create verified portable copy',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Portable copy ready'})).toBeVisible({timeout:120000});
  await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root));const exported=new Workspace(destination,f.vault),entries=(await new ProjectRegistry(exported,book.id).read()).value.projects;expect(entries).toHaveLength(2);
  for(const root of [destination,...entries.map(entry=>entry.root)]){expect(await catalogueBinding(root)).toBe(null);await access(path.join(root,CATALOGUE_ARCHIVE));await expect(access(path.join(root,'.observanda/postgresql'))).rejects.toMatchObject({code:'ENOENT'});}
  for(const project of projects)await project.read();
 }finally{await page.close();await app?.close();await owner.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-portable-owners-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
