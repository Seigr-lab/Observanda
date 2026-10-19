import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {createNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {navigate} from './preferences-helper.js';
import {task,openPageSettings,chooseWebsitePage} from './composer-helper.js';

test('create two independent websites, edit and publish their own saved content without changing research originals',async({page},info)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sites-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const original=await f.workspace.read(),record=original.book.entries[0],project=original.book.projects.find(p=>original.book.notebooks.find(n=>n.id===record.notebookId).projectId===p.id);
 const create=async name=>{await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill(name);await expect(page.getByLabel('Project',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Create website',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText(name);};
 const manager=async()=>page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();
 const open=async name=>{await page.locator('section.panel').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'Website editor',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText(name);};
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await expect(page.locator('.website-site-context')).toBeVisible();await manager();await create('Research journal');
  await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Research journal title');
  await task(page,'Content');await page.locator('[data-project-share="'+project.id+'"]').check();await expect(page.locator('[data-publish-entry]')).not.toHaveCount(0);await expect(page.locator('[data-publish-entry="'+record.id+'"]').first()).not.toBeChecked();await page.locator('[data-publish-entry="'+record.id+'"]').check();
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
  await navigate(page,'Website editor');await expect(page.locator('.website-site-context')).toBeVisible();await expect(page.locator('.website-site-context')).toContainText((await new WebsiteSites(f.workspace).read(null)).site.name);await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText(project.title);await page.screenshot({path:info.outputPath('project-website.png'),fullPage:false});
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.website-site-context')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('project-website-narrow.png'),fullPage:false});
  const after=await f.workspace.read();expect(after.book.entries).toEqual(original.book.entries);expect(after.book.website).toEqual(original.book.website);expect((await new WebsiteSites(f.workspace).list()).sites.filter(site=>site.id!==null)).toHaveLength(2);expect(errors).toEqual([]);
 }finally{await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});


test('default and named website editors save independently and refresh their own revision without changing research',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-tabs-'));let fixture,app,second;
 try{
  const book=createNotebook('Publishing workspace');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Field journal','Course website'])ids.push((await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.url);await navigate(page,'Website editor');await expect(page.locator('.website-site-context')).toBeVisible();
  const research=await fixture.workspace.outline(),defaultBefore=await sites.read(null);await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Default website title');
  const defaultSave=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/websites/editor/save');await page.getByRole('button',{name:'Save website',exact:true}).click();
  const defaultCommand=(await defaultSave).postDataJSON();expect(defaultCommand.websiteId).toBeNull();expect(defaultCommand.websitePin).toEqual(defaultBefore.websitePin);expect(defaultCommand.draftId).toEqual(expect.any(String));expect(defaultCommand.expectedRevision).toMatch(/^[a-f0-9]{64}$/);await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await sites.read(null)).book.website.title).toBe('Default website title');expect((await fixture.workspace.outline()).etag).toBe(research.etag);second=await page.context().newPage();
  const pages=[page,second],titles=['Field journal title','Course website title'];
  for(const [index,editor] of pages.entries()){
   await editor.goto(new URL('/#/websites/'+ids[index]+'/editor',app.url).href);await expect(editor.locator('.website-site-context')).toContainText(index?'Course website':'Field journal');
   await task(editor,'Site');await editor.getByLabel('Website title',{exact:true}).fill(titles[index]);
  }
  await Promise.all(pages.map(editor=>editor.getByRole('button',{name:'Save website',exact:true}).click()));
  for(const [index,editor] of pages.entries()){
   await expect(editor.locator('#save-status')).toHaveText('Saved');await expect(editor.locator('#leave-dialog')).not.toBeVisible();
   await editor.reload();await task(editor,'Site');await expect(editor.getByLabel('Website title',{exact:true})).toHaveValue(titles[index]);
   expect((await sites.read(ids[index])).book.website.title).toBe(titles[index]);
  }
  expect((await fixture.workspace.outline()).etag).toBe(research.etag);const before=await sites.read(ids[0]);
  const changed=await sites.save(ids[0],{workspaceId:book.id,baseEtag:before.etag,websitePin:before.websitePin,metadata:{website:{...before.book.website,title:'Externally saved journal'}},projects:[],changes:[],removed:[],selection:before.site.selection});
  expect(changed.etag).toBe(before.etag);expect(changed.websitePin.websiteRevision).not.toBe(before.websitePin.websiteRevision);
  let documents=0;page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documents++;});const route=page.url();
  await page.getByRole('link',{name:/refresh saved workspace/}).click();await expect(page.getByLabel('Website title',{exact:true})).toHaveValue('Externally saved journal');expect(page.url()).toBe(route);expect(documents).toBe(0);
  await expect(second.getByLabel('Website title',{exact:true})).toHaveValue(titles[1]);
  await page.getByLabel('Website title',{exact:true}).fill('Continued after refresh');await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await sites.read(ids[0])).book.website.title).toBe('Continued after refresh');expect((await sites.read(null)).book.website.title).toBe('Default website title');expect((await fixture.workspace.outline()).etag).toBe(research.etag);
  await page.locator('.website-site-context').getByRole('button',{name:'Appearance',exact:true}).click();await expect(page).toHaveURL(new RegExp('/websites/'+ids[0]+'/appearance'));
  await page.getByLabel('Accent',{exact:true}).fill('#334455');await expect(page.frameLocator('#design-preview').locator('body')).toHaveCSS('--accent','#334455');
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');expect((await sites.read(ids[0])).book.appearance.accent).toBe('#334455');
  expect((await sites.read(null)).book.appearance).toEqual(defaultBefore.book.appearance);expect((await fixture.workspace.outline()).etag).toBe(research.etag);
 }finally{await second?.close();await page.close();await app?.close();if(fixture)clearVault(fixture.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});
