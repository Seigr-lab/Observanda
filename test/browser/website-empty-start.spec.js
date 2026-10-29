import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {emptyHomepage} from '../../src/web/website-model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {chooseWebsitePage} from './composer-helper.js';

test('unused website stays empty beside research, and explicit pages survive saving and reopening',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-empty-')),book=sampleNotebook();book.website.home=emptyHomepage();
 const fixture=await encryptedFixture(directory,book),sites=new WebsiteSites(fixture.workspace),before=await sites.read(null),app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const previews=[],errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/api/design-preview'))previews.push(request.postDataJSON());});
 const canvas=page.frameLocator('#website-draft-preview'),projectPath='projects/'+book.projects[0].id+'.html';
 try{
  await page.goto(app.url);await navigate(page,'Website editor');
  await expect(page.locator('#website-preview-empty')).toBeVisible();await expect(page.getByLabel('Page',{exact:true})).toHaveValue('');
  expect(previews).toEqual([]);expect((await sites.read(null)).websitePin.websiteRevision).toEqual(before.websitePin.websiteRevision);
  // Old clients remembered their automatic fallback as though the user chose it.
  await page.evaluate(({id,path})=>sessionStorage.setItem('observanda.editor.'+id+'.workspace',JSON.stringify({path})),{id:book.id,path:projectPath});
  await page.reload();await expect(page.locator('#website-preview-empty')).toBeVisible();expect(previews).toEqual([]);
  await chooseWebsitePage(page,projectPath);await expect(canvas.locator('#page-records')).toBeVisible();
  await page.reload();await expect(page.getByLabel('Page',{exact:true})).toHaveValue(projectPath);await expect(canvas.locator('#page-records')).toBeVisible();
  expect((await sites.read(null)).websitePin.websiteRevision).toEqual(before.websitePin.websiteRevision);
  await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();
  await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Own design');await page.getByRole('button',{name:'Create website',exact:true}).click();
  await expect(page.locator('#website-preview-empty')).toBeVisible();await expect(page.getByLabel('Page',{exact:true})).toHaveValue('');
  const site=(await sites.list()).sites.find(site=>site.name==='Own design'),fresh=await sites.read(site.id);
  expect(fresh.site.projects.every(project=>!project.share)).toBe(true);expect(fresh.site.selection).toEqual({defaultShare:false,includeProjects:[],records:[]});expect(fresh.book.pages).toEqual([]);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Add a page',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});await page.getByLabel('Page title',{exact:true}).fill('Only my content');await page.getByLabel('Page introduction',{exact:true}).fill('Written by the author.');
  await expect(canvas.locator('main')).toContainText('Written by the author.');await expect(canvas.locator('#page-records,#page-notebooks,[data-book-index]')).toHaveCount(0);await expect(canvas.locator('.site-menu a')).toHaveText(['Only my content']);
  await expect(canvas.locator('body')).not.toContainText(book.projects[0].title);await expect(canvas.locator('body')).not.toContainText(book.entries[0].title);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(canvas.locator('main')).toContainText('Written by the author.');await expect(canvas.locator('#page-records,#page-notebooks,[data-book-index]')).toHaveCount(0);
  expect((await sites.read(site.id)).book.pages[0].body).toBe('Written by the author.');expect((await sites.read(null)).websitePin.websiteRevision).toEqual(before.websitePin.websiteRevision);
  expect(errors).toEqual([]);
 }finally{await page.close();await app.close();clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
