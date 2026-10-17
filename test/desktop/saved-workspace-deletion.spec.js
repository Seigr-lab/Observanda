import {test,expect} from '@playwright/test';
import {access,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {desktopFixture} from './fixture.js';

test('packaged upgrade deletes a closed dedicated workspace and reopens the preserved active owner',async()=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_PREVIOUS_EXECUTABLE||!process.env.OBSERVANDA_DESKTOP_EXECUTABLE,'Requires both previous and candidate packaged builds.');test.setTimeout(240000);
 const fixture=await desktopFixture('observanda-desktop-saved-delete-'),remove=path.join(fixture.directory,'remove'),keep=path.join(fixture.directory,'keep'),bytes=Buffer.alloc(2*1024*1024,73);let app,page;
 const launch=async(executable)=>{app=await fixture.start(executable);page=await app.firstWindow();};
 const create=async(title,root)=>{
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});await page.getByLabel('Workspace name',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(root);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(title,{timeout:60000});
 };
 const snapshot=()=>page.evaluate(async()=>{
  const storage=await (await fetch('/api/storage')).json(),r=await fetch('/api/workspace/read/start',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:'{}'});
  if(!r.ok)throw Error('Cannot read saved workspace');const {cursor,...outline}=await r.json();return {root:storage.root,outline};
 });
 try{
  await launch(process.env.OBSERVANDA_DESKTOP_PREVIOUS_EXECUTABLE);await create('Remove after upgrade',remove);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await page.locator('#dialog').getByRole('button',{name:'New workspace',exact:true}).click();await create('Keep after upgrade',keep);
  const before=await snapshot(),accessBefore=await readFile(path.join(keep,'.observanda/access.json'));
  await writeFile(path.join(keep,'.observanda/keep-original.bin'),bytes);await writeFile(path.join(remove,'.observanda/remove-original.bin'),bytes);
  await fixture.close(app);app=null;
  await launch();await expect(page.locator('.topbar .workspace-name')).toHaveText('keep',{timeout:60000});const upgraded=await snapshot();expect(upgraded.root).toBe(before.root);expect(upgraded.outline.metadata.id).toBe(before.outline.metadata.id);expect(upgraded.outline.metadata.projects).toEqual(before.outline.metadata.projects);expect(upgraded.outline.metadata.notebooks).toEqual(before.outline.metadata.notebooks);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();const management=page.locator('.workspace-management'),dialog=page.locator('#dialog');await expect(page).toHaveURL(/#\/workspaces$/);await expect(dialog).not.toBeVisible();await expect(management.getByRole('button',{name:'Delete workspace',exact:true})).toHaveCount(2);
  await management.locator('article').filter({hasText:remove}).getByRole('button',{name:'Delete workspace',exact:true}).click();await expect(dialog.getByText(remove,{exact:true})).toBeVisible();
  await expect(dialog.getByText("The workspace's dedicated PostgreSQL database will also be removed.",{exact:true})).toBeVisible();
  await dialog.getByLabel('Type the workspace name to confirm').fill('remove');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Delete workspace',exact:true}).click();
  await expect(dialog).not.toBeVisible({timeout:60000});await expect(management.getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible();await expect(management.getByText(remove,{exact:true})).toHaveCount(0);await expect(management.getByText(keep,{exact:true})).toBeVisible();
  await expect(access(remove)).rejects.toMatchObject({code:'ENOENT'});expect(await snapshot()).toEqual(upgraded);expect(await readFile(path.join(keep,'.observanda/access.json'))).toEqual(accessBefore);expect(await readFile(path.join(keep,'.observanda/keep-original.bin'))).toEqual(bytes);
  await fixture.close(app);app=null;await launch();await expect(page.locator('.topbar .workspace-name')).toHaveText('keep',{timeout:60000});expect(await snapshot()).toEqual(upgraded);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await expect(page).toHaveURL(/#\/workspaces$/);await expect(page.locator('#dialog')).not.toBeVisible();await expect(page.locator('.workspace-management').getByRole('button',{name:'Delete workspace',exact:true})).toHaveCount(1);await expect(page.locator('.workspace-management').getByText(remove,{exact:true})).toHaveCount(0);
 }finally{await fixture.dispose(app);}
});
