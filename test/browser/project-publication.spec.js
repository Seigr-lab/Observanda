import {test,expect} from '@playwright/test';
import path from 'node:path';
import {testServer} from '../device-fixture.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {workspaceReachFixture} from './workspace-reach-fixture.js';
import {navigate,openDefaultWebsite} from './preferences-helper.js';
import {websitePreparationFinished} from './website-preparation-helper.js';

// A workspace website presents records from a project's lab book. The library
// offers only what each lab book shares, lists a locked project as locked with
// its own unlock prompt, and never reaches another workspace.
test('a workspace website using records from a project\'s lab book',async({page})=>{
 test.setTimeout(240000);page.setDefaultTimeout(15000);
 const fixture=await workspaceReachFixture('project-publication'),{f,apiary,sealed}=fixture,errors=[];let app;
 try{
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(fixture.directory,'preferences.json')});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await navigate(page,'Website editor');const siteId=await openDefaultWebsite(page);expect(siteId).toBeTruthy();
  // The library's hints describe finished discovery: wait for the one-time preparation.
  await websitePreparationFinished(page);

  const library=page.locator('dialog[data-website-picker-dialog]'),search=library.getByLabel('Search entries',{exact:true}),rows=library.locator('.website-picker-results li');
  const find=async(text,count)=>expect(async()=>{await search.fill(text);await search.press('Enter');await expect(rows.filter({hasText:text})).toHaveCount(count,{timeout:2000});}).toPass({timeout:90000});
  await page.getByRole('button',{name:'Browse available content',exact:true}).click();await expect(library).toBeVisible();
  // The open project's shared record arrives through workspace discovery.
  await find(apiary.shared.title,1);
  await find(apiary.private.title,0);await find('Other workspace project',0);await find(sealed.shared.title,0);
  await expect(library.locator('.hint')).toContainText('Unlock the research workspace');

  await library.getByRole('button',{name:'Projects and lab books',exact:true}).click();
  const owners=page.locator('dialog[data-workspace-owner-picker]');await expect(owners).toBeVisible();
  await expect(owners.locator('[data-owner-row="'+apiary.book.id+'"]')).toHaveAttribute('data-owner-access','open');
  await expect(owners.locator('[data-owner-row="'+sealed.book.id+'"]')).toHaveAttribute('data-owner-access','locked');
  await expect(owners.locator('[data-owner-row="'+sealed.book.id+'"]')).toContainText('Sealed archive is locked. Unlock it to see its shared records.');
  await expect(owners).not.toContainText('Other workspace project');

  await owners.getByRole('button',{name:'Show records in Apiary project',exact:true}).click();
  await expect(owners.locator('[data-owner-record="'+apiary.shared.id+'"]')).toContainText(apiary.shared.title);
  await expect(owners.locator('[data-owner-record="'+apiary.private.id+'"]')).toHaveCount(0);
  await owners.getByRole('button',{name:'All projects and lab books',exact:true}).click();

  await owners.getByRole('button',{name:'Unlock Sealed archive',exact:true}).click();
  const unlock=page.locator('#project-unlock-form');await unlock.getByLabel('Project password',{exact:true}).fill(fixture.sealedPassword);await unlock.getByRole('button',{name:'Unlock',exact:true}).click();
  await expect(owners.locator('[data-owner-record="'+sealed.shared.id+'"]')).toContainText(sealed.shared.title);
  await expect(owners.locator('[data-owner-record="'+sealed.private.id+'"]')).toHaveCount(0);
  await owners.getByRole('button',{name:'Close',exact:true}).click();await expect(owners).toHaveCount(0);

  // Unlocking resumed discovery: the sealed project's shared record joins the library.
  // The private record stays out; the shared one is searched last, so its row is listed for selection.
  await find(sealed.private.title,0);await find(sealed.shared.title,1);
  await rows.filter({hasText:sealed.shared.title}).getByRole('button',{name:sealed.shared.title,exact:true}).click();
  await library.getByRole('button',{name:'Insert selected content',exact:true}).click();
  await expect.poll(async()=>(await new WebsiteFileStore(f.workspace).open(siteId)).html.includes(sealed.shared.id),{timeout:30000}).toBe(true);
  await library.getByRole('button',{name:'Close content picker',exact:true}).click();
  await expect(page.frameLocator('#website-files-canvas').getByText(sealed.shared.title).first()).toBeVisible({timeout:30000});
  const saved=await new WebsiteFileStore(f.workspace).open(siteId);
  expect(saved.html.includes(sealed.private.title)).toBe(false);expect(saved.html.includes(fixture.foreign.shared.title)).toBe(false);
  expect(errors).toEqual([]);
 }catch(error){
  await test.info().attach('workspace-website-failure',{body:await page.screenshot(),contentType:'image/png'});throw error;
 }finally{await app?.close();await fixture.close();}
});
