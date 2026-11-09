import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('a required review comments on a figure caption, approves the corrected edition and turns stale after a later edit',async({page})=>{
 test.setTimeout(150000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-review-')),out=path.join(dir,'Publication'),db=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture;
 try{
  await mkdir(out);fixture=await encryptedFixture(dir,createNotebook('Survey'));const id=randomUUID();
  const html='<!doctype html><html lang="en"><head><title>Plankton atlas</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Plankton atlas</h1><section id="counts"><h2>Counts</h2><p>Copepod counts by station.</p></section></main></body></html>';
  await new WebsiteFileStore(fixture.workspace).importFiles(id,{name:'Plankton atlas',files:new Map([['index.html',html],['style.css','main{max-width:40rem}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(dir,'preferences.json'),port:0});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),tools=page.getByRole('navigation',{name:'Website'}),panel=page.locator('[data-website-review]'),status=page.locator('[data-website-files-status]');
  await expect(canvas.getByRole('heading',{name:'Plankton atlas'})).toBeVisible();
  const closeReview=async()=>{await expect(async()=>{await panel.getByRole('button',{name:'Return to editing'}).click();await expect(panel).toBeHidden({timeout:1000});}).toPass();};
  const openReview=async()=>{await tools.getByRole('button',{name:'Review',exact:true}).click();await expect(panel.getByRole('heading',{name:'Review',exact:true})).toBeFocused();};
  const publish=async()=>{
   await tools.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(out);
   await page.getByRole('button',{name:'Review file changes'}).click();await page.locator('[data-website-file-folder-confirm]').check();
   await page.getByRole('button',{name:'Write reviewed files'}).click();
  };

  // Turn on the approval requirement; publishing is refused with an explanation.
  await openReview();await expect(panel.locator('[data-review-status]')).toHaveText('The current saved edition has not been reviewed.');
  await panel.getByLabel('Require an approved review before publishing').check();
  await expect(panel).toContainText('Publishing is blocked until someone approves this exact edition.');
  await closeReview();
  await tools.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(out);
  await page.getByRole('button',{name:'Review file changes'}).click();await expect(page.getByText('requires an approved review of the current saved edition')).toBeVisible();
  await page.getByRole('button',{name:'Return to editing'}).click();

  // Request a review and comment on the selected section.
  await openReview();await panel.getByLabel('Message for reviewers').fill('Check the counts section.');
  await panel.getByRole('button',{name:'Request review'}).click();
  await expect(panel.locator('[data-review-status]')).toHaveText('A review of the current saved edition is open.');
  await closeReview();
  await canvas.locator('#counts').click({position:{x:4,y:4}});
  await openReview();
  await panel.getByLabel('Comment on the selected element').fill('State the sampling depth.');
  await panel.getByRole('button',{name:'Add comment'}).click();
  const comment=panel.locator('[data-review-comment]');await expect(comment).toHaveCount(1);await expect(comment).toContainText('State the sampling depth.');
  await expect(comment).toContainText('On a section element');
  await comment.getByRole('button',{name:'Show in page'}).click();
  await expect(panel).toBeHidden();

  // Correct the text, save, and confirm the request now describes an earlier edition.
  const paragraph=canvas.locator('#counts p');await paragraph.click();await page.keyboard.press('End');await page.keyboard.type(' Depth 0–50 m.');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(status).toHaveText('Website saved.');
  await openReview();
  await expect(panel.locator('[data-review-stale]')).toBeVisible();
  await expect(comment).toContainText('The element has changed since this comment');
  await panel.getByRole('button',{name:'Show changes since this review'}).click();await expect(panel).toContainText('index.html');
  await comment.getByRole('button',{name:'Resolve'}).click();await expect(comment).toContainText('Resolved by This workspace');
  await panel.getByRole('button',{name:'Request review'}).click();
  const approve=panel.getByRole('button',{name:'Approve this edition'});await approve.focus();await approve.press('Enter');
  await expect(panel.locator('[data-review-status]')).toHaveText('The current saved edition is approved for publication.');
  await closeReview();
  await publish();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  expect(await readFile(path.join(out,'index.html'),'utf8')).toContain('Depth 0–50 m.');
  expect(await readFile(path.join(out,'index.html'),'utf8')).not.toContain('sampling depth');
  await page.getByRole('button',{name:'Return to editing'}).click();

  // A later edit leaves the approval with the earlier edition.
  await paragraph.click();await page.keyboard.press('End');await page.keyboard.type(' Revised.');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(status).toHaveText('Website saved.');
  await openReview();await expect(panel.locator('[data-review-status]')).toHaveText('The current saved edition has not been reviewed.');
  await expect(panel.locator('[data-review-stale]').first()).toBeVisible();
  expect(errors).toEqual([]);
 }finally{
  if(db===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=db;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});
