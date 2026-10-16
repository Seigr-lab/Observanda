import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {navigate} from './preferences-helper.js';
import {task,openPageSettings,chooseWebsitePage} from './composer-helper.js';

test('create two project websites, edit and publish their own saved content without changing research originals',async({page},info)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sites-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const original=await f.workspace.read(),record=original.book.entries[0],project=original.book.projects.find(p=>original.book.notebooks.find(n=>n.id===record.notebookId).projectId===p.id);
 const create=async name=>{await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill(name);await page.getByLabel('Project',{exact:true}).selectOption(project.id);await page.getByRole('button',{name:'Create website',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText(name);};
 const manager=async()=>page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();
 const open=async name=>{await page.locator('section.panel').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'Website editor',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText(name);};
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await manager();await create('Research journal');
  await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Research journal title');
  await task(page,'Content');await expect(page.locator('[data-publish-entry]')).not.toHaveCount(0);await expect(page.locator('[data-publish-entry="'+record.id+'"]').first()).not.toBeChecked();await page.locator('[data-publish-entry="'+record.id+'"]').check();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await chooseWebsitePage(page,'entries/'+record.id+'.html');await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();
  await page.getByLabel('Display heading',{exact:true}).fill('Research journal record');
  await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Research journal record',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Research journal record',exact:true})).toBeVisible();
  await chooseWebsitePage(page,'projects/'+project.id+'.html');
  const firstUrl=page.url();
  await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Unfinished title');await manager();await expect(page.locator('#leave-dialog')).toBeVisible();await page.getByRole('button',{name:'Stay here',exact:true}).click();await expect(page.getByLabel('Website title',{exact:true})).toHaveValue('Unfinished title');await page.getByLabel('Website title',{exact:true}).fill('Research journal title');await expect(page.getByRole('button',{name:'Save website',exact:true})).toBeDisabled();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();
  await page.getByLabel('GitHub owner / organization',{exact:true}).fill('Example');await page.getByLabel('Repository name',{exact:true}).fill('research-journal');
  await page.getByRole('button',{name:'Save destination',exact:true}).click();await expect(page.locator('#destination-status')).toHaveText('Destination saved on this device.');
  await manager();await create('Help pages');
  await task(page,'Content');await expect(page.locator('[data-publish-entry="'+record.id+'"]')).not.toBeChecked();
  await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(page.getByLabel('Repository name',{exact:true})).toHaveValue('');
  await page.getByLabel('Publish with',{exact:true}).selectOption('ssh');await page.getByLabel('SSH hostname',{exact:true}).fill('example.org');await page.getByLabel('SSH user',{exact:true}).fill('web');await page.getByLabel('Dedicated hosting directory',{exact:true}).fill('/web/help');
  await page.getByRole('button',{name:'Save destination',exact:true}).click();await expect(page.locator('#destination-status')).toHaveText('Destination saved on this device.');
  await manager();await open('Research journal');await task(page,'Site');await expect(page.getByLabel('Website title',{exact:true})).toHaveValue('Research journal title');
  await page.reload();await expect(page.locator('.website-site-context')).toContainText('Research journal');
  await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(page.getByLabel('Repository name',{exact:true})).toHaveValue('research-journal');
  await page.goto(firstUrl);await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.locator('#full-public-preview')).toBeVisible();
  const preview=await page.locator('#full-public-preview').getAttribute('href'),published=await page.context().newPage();
  try{
   await published.goto(new URL(preview,app.url).href);await expect(published.locator('body')).toContainText('Research journal title');
   await published.locator('a[href$="entries/'+record.id+'.html"]').first().click();
   await expect(published.getByRole('heading',{name:'Research journal record',exact:true})).toBeVisible();
  }finally{await published.close();}
  await navigate(page,'Website editor');await expect(page.locator('.website-site-context')).toContainText('Workspace website');await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText(project.title);await page.screenshot({path:info.outputPath('project-website.png'),fullPage:false});
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.website-site-context')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('project-website-narrow.png'),fullPage:false});
  const after=await f.workspace.read();expect(after.book.entries).toEqual(original.book.entries);expect(after.book.website).toEqual(original.book.website);expect(after.book.websites).toHaveLength(2);expect(errors).toEqual([]);
 }finally{await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
