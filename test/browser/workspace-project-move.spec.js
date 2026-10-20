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
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {Workspace} from '../../src/storage.js';
import {preferences} from './preferences-helper.js';

test('Move workspace includes independent projects and retains password-unlocked access after switching',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bundle-move-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app;
 try{
  const book=sampleNotebook(),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,book.id);
  const project=sampleNotebook(),keys=await createWorkspaceAccess('Teacher','Project password',f.deviceStore),vault=takeCreatedVault(keys);vaults.push(vault);project.title=project.projects[0].title='Original project';const source=await initializeProjectLocation(path.join(directory,'Original project'),project.projects[0].id,project,keys,vault);await registry.attach(source,{expected:'new'});
  const childBook=sampleNotebook(),childKeys=await createWorkspaceAccess('','',f.deviceStore),childVault=takeCreatedVault(childKeys);vaults.push(childVault);childBook.title=childBook.projects[0].title='Nested project';const child=await initializeProjectLocation(path.join(f.workspace.root,'Nested project'),childBook.projects[0].id,childBook,childKeys,childVault);await registry.attach(child,{expected:(await registry.read()).revision});
  const destination=path.join(directory,'Research Workspace 1');app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')});await page.goto(app.url);await preferences(page,'Storage & access');
  const unlocked=await page.evaluate(async id=>{const storage=await fetch('/api/storage').then(r=>r.json());const response=await fetch('/api/projects/'+id+'/access/unlock',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:JSON.stringify({username:'Teacher',password:'Project password',recovery:''})});return {status:response.status,body:await response.text()};},source.projectId);expect(unlocked.status,unlocked.body).toBe(200);
  await page.getByRole('button',{name:'Move workspace to another folder',exact:true}).click();const form=page.locator('#storage-move-form');await form.getByLabel('Workspace folder',{exact:true}).fill(destination);await form.getByRole('button',{name:'Move and use this folder',exact:true}).click();let moveStatus;await expect.poll(async()=>moveStatus=await form.isVisible()?await form.locator('[data-transfer-error]').textContent()||'running':'complete',{timeout:120000}).not.toBe('running');expect(moveStatus).toBe('complete');
  await expect(page.locator('.notice')).toContainText('Workspace moved and verified');await expect(page.locator('.workspace-name')).toHaveText('Research Workspace 1');await expect(access(f.workspace.root)).rejects.toMatchObject({code:'ENOENT'});await expect(access(source.root)).rejects.toMatchObject({code:'ENOENT'});
  const entries=(await new ProjectRegistry(new Workspace(destination,f.vault),book.id).read()).value.projects;expect(entries).toHaveLength(2);for(const entry of entries)expect(entry.root.startsWith(destination+path.sep)).toBe(true);
  await page.goto(app.origin+'/#/owners/'+source.projectId+'/projects/'+source.projectId);await expect(page.locator('[data-project-storage="'+source.projectId+'"]')).toContainText(entries.find(entry=>entry.projectId===source.projectId).root);await expect(page.locator('#project-unlock-form')).toHaveCount(0);await expect(page.locator('#project-recent-records')).toContainText(project.entries[0].title);
  assert.deepEqual((await new ProjectStorage(entries.find(entry=>entry.projectId===child.projectId).root,child.projectId,childVault).read()).book,childBook);
 }finally{await page.close();await app?.close();await owner.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-bundle-move-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
