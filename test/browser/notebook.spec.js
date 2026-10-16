import {task,editorTab,openPageSettings} from './composer-helper.js';
import {navigate,preferences,editWorkspace} from './preferences-helper.js';
import {TestDeviceStore as DeviceStore} from '../device-fixture.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import { test, expect } from '@playwright/test';
import { mediaFixtures } from '../media-fixtures.js';
import { mediaCapabilities } from '../../src/media.js';
import http from 'node:http';
import {defaultEditionRecord} from '../../src/web/publication-selection.js';
import {recordRevision} from '../../src/research.js';
import {upgradeNotebook} from '../../src/model.js';
import { buildPublication } from '../../src/publication.js';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer as startServer} from '../device-fixture.js';
import { Workspace } from '../../src/storage.js';
import { startingAppearance } from '../../src/web/themes.js';
import { sampleNotebook } from '../../src/sample.js';

let app, root, deviceStore;
async function saveChanges(page){const save=page.locator('.section-save [data-action=save]');if(await save.isEnabled())await save.click();await expect(page.locator('#save-status')).toHaveText('Saved');}
test.beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'observanda-browser-')); deviceStore=new DeviceStore({file:root+'.device-key'}); app = await startServer({ root, port: 0,deviceStore }); });
test.afterEach(async () => { await app.close(); });

test('create, edit, persist, customize, review, and download an independent notebook', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url);
  await page.getByLabel('Workspace name').fill('Garden experiments');
  await page.getByText('Add a description',{exact:false}).click();await page.getByLabel('Workspace description').fill('Questions from the windowsill.');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Use this device',{exact:false}).check();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await navigate(page,'Projects');
  await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Garden project');await page.getByRole('button',{name:'Save project',exact:true}).click();
  await page.locator('main').getByRole('button',{name:'New lab book',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Lab book name',{exact:true}).fill('Garden observations');
  await page.getByRole('dialog').getByRole('button',{name:'Save lab book',exact:true}).click();
  await page.getByRole('button',{name:'Open lab book',exact:true}).click();
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Create observation', exact: true }).click();
  await page.getByLabel('Record title').fill('First green leaves');
  await page.getByLabel('Summary / context').fill('Two leaves opened today.\nThe soil was still damp.');
  await page.getByLabel('Include in website').check();
  await page.getByRole('button', { name: 'Add figure',exact:true }).click();
  await page.getByRole('button',{name:'Add measurement',exact:true}).click();
  await page.getByLabel('Coordinate 1',{exact:true}).fill('1');
  await page.getByLabel('Coordinate 2',{exact:true}).fill('2');
  await page.getByLabel('Value 1', { exact: true }).fill('3');
  await page.getByLabel('Value 2', { exact: true }).fill('8');
  await page.locator('.section-save [data-action=save]').click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();
  await navigate(page,'All records');
  await page.getByRole('button', { name: 'First green leaves' }).click();
  await expect(page.getByLabel('Summary / context').locator('p')).toHaveText(['Two leaves opened today.','The soil was still damp.']);
  await navigate(page,'Website editor');
  await editorTab(page,'Content');await page.getByRole('button', { name: 'Include all entries', exact: true }).click();
  await saveChanges(page);
  await saveChanges(page);
  await preferences(page,'Appearance');
  await page.getByRole('button', { name: /Studio/ }).click();
  await expect(page.frameLocator('#design-preview').getByRole('heading', { name: 'First green leaves' })).toBeVisible();
  await saveChanges(page);
  await navigate(page,'Website editor');await page.getByRole('button', { name: 'Preview & export' }).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  await expect(page.frameLocator('iframe[title="Publication preview"]').getByRole('heading', { name: 'First green leaves' })).toBeVisible();
  await page.getByLabel('I have reviewed').check();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download website ZIP' }).click();
  const download = await downloadEvent;
  const zip = await readFile(await download.path());
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.toString('utf8')).toContain('First green leaves');
  expect(zip.toString('utf8')).not.toContain(root);
  expect(errors).toEqual([]);
});

test('private-path detection blocks review and keeps the original note editable', async ({ page }) => {
  await new Workspace(root).create(sampleNotebook());
  await page.goto(app.url);
  await navigate(page,'All records');
  await page.getByRole('button', { name: 'Watching a seed unfold' }).click();
  await page.getByLabel('Summary / context').fill('/home/imaginary-person/private-log');
  await saveChanges(page);
  await navigate(page,'Website editor');await page.getByRole('button', { name: 'Preview & export' }).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Export blocked');
  await expect(page.getByRole('dialog')).not.toContainText('imaginary-person');
  await page.getByRole('button', { name: 'Open record' }).click();
  await expect(page.getByLabel('Summary / context')).toHaveText('/home/imaginary-person/private-log');
});

test('edits made while a save is in flight are kept, then saved on the next request', async ({ page }) => {
  await new Workspace(root).create(sampleNotebook());
  await page.goto(app.url);
  await navigate(page,'All records');
  await page.getByRole('button', { name: 'Watching a seed unfold' }).click();
  let release; const waiting = new Promise(resolve => { release = resolve; });
  await page.route('**/api/research/records/save', async route => { await waiting; await route.continue(); });
  await page.getByLabel('Summary / context').fill('First draft');
  const sent=page.waitForRequest('**/api/research/records/save');
  await page.locator('.section-save [data-action=save]').click();
  await sent;
  await page.getByLabel('Summary / context').fill('Newer draft while saving');
  release();
  await expect(page.locator('.section-save [data-action=save]')).toBeEnabled();
  await expect(page.getByLabel('Summary / context')).toHaveText('Newer draft while saving');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  await page.unroute('**/api/research/records/save');
  await page.locator('.section-save [data-action=save]').click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();
  await navigate(page,'All records');
  await page.getByRole('button', { name: 'Watching a seed unfold' }).click();
  await expect(page.getByLabel('Summary / context')).toHaveText('Newer draft while saving');
});

test('desktop and mobile layouts remain usable with real sample content', async ({ page }) => {
  await new Workspace(root).create(sampleNotebook());
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact:true })).toBeVisible();
  await mkdir('.local/screenshots', { recursive: true });
  await page.screenshot({ path: '.local/screenshots/notebook-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });

  await navigate(page,'All records');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Watching a seed unfold' }).click();
  await expect(page.getByLabel('Summary / context')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '.local/screenshots/notebook-mobile.png', fullPage: true });
});


test('exported themes work as standalone sites at root and nested paths with JavaScript disabled', async ({ browser }) => {
  const book=upgradeNotebook(sampleNotebook()),choice=defaultEditionRecord(book.entries[0],recordRevision(book.entries[0]));choice.figures.forEach(f=>f.data=true);const edition={version:1,records:[choice]};
  let files = buildPublication(book,{edition}).files;
  const standalone = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = pathname.replace(/^\/(?:lab\/field-notes\/)?/, '') || 'index.html';
    const content = files.get(name);
    if (content === undefined) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(content);
  });
  await new Promise(resolve => standalone.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${standalone.address().port}`;
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(), requests = [], failures = [];
    page.on('request', request => requests.push(request.url()));
    page.on('requestfailed', request => failures.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
    await mkdir('.local/screenshots', { recursive: true });
    for (const theme of ['research', 'studio']) {
      book.appearance = startingAppearance(theme); files = buildPublication(book,{edition}).files;
      for (const base of ['/', '/lab/field-notes/']) {
        await page.goto(origin + base);
        await page.getByRole('link', { name: 'Watching a seed unfold', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Watching a seed unfold' })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Listening to the room');
        expect(await page.locator('body').evaluate(el => getComputedStyle(el).margin)).toBe('0px');
        expect(await page.locator('figure img').evaluate(el => el.complete && el.naturalWidth > 0)).toBeTruthy();
        await page.getByText('View the data', { exact: true }).click();
        await expect(page.getByRole('table')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      }
      await page.screenshot({ path: `.local/screenshots/${theme}-site.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByRole('heading', { name: 'Watching a seed unfold' })).toBeVisible();
      await page.emulateMedia({ media: 'screen' });
    }
    expect(failures).toEqual([]);
    expect(requests.every(url => url.startsWith(origin + '/'))).toBeTruthy();
  } finally {
    await context.close();
    await new Promise(resolve => { standalone.close(resolve); standalone.closeAllConnections(); });
  }
});


test('a new entry defaults to the author local calendar date', async ({ browser }) => {
  await new Workspace(root).create(sampleNotebook());
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-09-26T01:00:00Z'));
    await page.goto(app.url);
    await navigate(page,'All records');
    await page.getByRole('button', { name: 'New record', exact: true }).click();
    await page.getByRole('button', { name: 'Create observation', exact: true }).click();
    await expect(page.getByLabel('Record date',{exact:true})).toHaveValue('2026-09-25');
  } finally { await context.close(); }
});


test('build two projects with structured research, playable media, custom pages, branding, fonts, and navigation', async ({ page }) => {
  test.setTimeout(60000);
  test.skip(!(await mediaCapabilities()).available, 'FFmpeg and ffprobe are required for media tests.');
  const fixtures = await mediaFixtures(await mkdtemp(path.join(os.tmpdir(), 'observanda-browser-fixtures-')));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await new Workspace(root).create(sampleNotebook());
  await page.goto(app.url);
  await navigate(page,'Projects');
  await page.locator('main').getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Acoustic studies');
  await page.getByRole('dialog').getByLabel('Description').fill('Measurements and listening experiments.');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acoustic studies', exact: true })).toBeVisible();
  await page.locator('main').getByRole('button', { name: 'New lab book', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Lab book name', { exact: true }).fill('Room acoustics');
  await page.getByRole('button', { name: 'Save lab book', exact: true }).click();
  await page.getByRole('button',{name:'Open lab book',exact:true}).click();
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Create experiment', exact: true }).click();
  await page.getByLabel('Record title').fill('Comparing two room positions');
  await page.getByLabel('Summary / context').fill('A controlled listening experiment.');
  await page.getByLabel('Question and objectives content', { exact: true }).fill('Does the recording position change the observed decay?');
  await page.getByLabel('Method content', { exact: true }).fill('Use the same source and repeat both positions.');
  await page.getByLabel('Progress', { exact: true }).selectOption('in progress');
  for (const [index, kind] of ['image', 'audio', 'video'].entries()) {
    await page.getByLabel('Add media', { exact: true }).setInputFiles(fixtures[kind].file);
    const item = page.locator('.media-item').nth(index);
    await expect(item).toBeVisible({ timeout: 20000 });
    await item.getByLabel('Caption', { exact: true }).fill(`Synthetic ${kind} evidence`);
    await item.getByLabel('Include this media in website').check();
    if (kind !== 'image') {
      await item.getByLabel('Transcript / extended description', { exact: true }).fill('Synthetic test recording.');
      await expect.poll(() => item.locator(kind).evaluate(el => el.readyState)).toBeGreaterThanOrEqual(1);
      await item.locator(kind).evaluate(el => el.play());
      await expect.poll(() => item.locator(kind).evaluate(el => el.currentTime)).toBeGreaterThan(0);
    }
  }
  await page.getByLabel('Include in website', { exact: false }).first().check();
  await page.locator('.section-save [data-action=save]').click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.screenshot({ path: '.local/screenshots/research-editor.png', fullPage: true });
  await navigate(page,'Website editor');await editorTab(page,'Content');
  await page.locator('.publication-project').filter({ hasText: 'Acoustic studies' }).getByRole('button', { name: 'Include all entries' }).click();
  await saveChanges(page);await preferences(page,'Appearance');await page.getByRole('button',{name:'Logos & branding',exact:true}).click();
  await page.getByLabel('Add logo',{exact:true}).setInputFiles(fixtures.image.file);
  await expect(page.getByLabel('Logo 1 alternative text')).toBeVisible({timeout:20000});
  await page.getByLabel('Logo 1 alternative text').fill('The independent research studio');await saveChanges(page);await navigate(page,'Website editor');
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('footer');await page.getByLabel('Footer text').fill('Research and creative practice.');
  await saveChanges(page);
  await editorTab(page,'Pages');await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await page.getByLabel('Page title', { exact: true }).fill('About this work');
  await page.getByLabel('Page introduction', { exact: true }).fill('A place for scientific and artistic investigation.');

  await page.getByRole('button', { name: 'Save website', exact: true }).click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await editorTab(page,'Navigation');await page.getByLabel('Menu label 1', { exact: true }).fill('Overview');
  await page.getByLabel('Menu label 2', { exact: true }).fill('Field studies');
  await page.getByRole('button', { name: 'Move menu item 3 up', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '.local/screenshots/website-settings.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '.local/screenshots/website-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await saveChanges(page);
  await preferences(page,'Appearance');
  await chooseFont(page,'Heading font','space-grotesk');
  await chooseFont(page,'Body font','source-serif');
  await page.getByLabel('Background', { exact: true }).fill('#f0f4f8');
  await saveChanges(page);
  await navigate(page,'Website editor');await page.getByRole('button', { name: 'Preview & export', exact: true }).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  const preview = page.frameLocator('iframe[title="Publication preview"]');
  await expect(preview.getByRole('navigation').getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  await expect(preview.getByRole('navigation').getByRole('link', { name: 'Acoustic studies', exact: true })).toBeVisible();
  await expect(preview.getByRole('img', { name: 'The independent research studio' })).toBeVisible();
  await preview.getByRole('navigation').getByRole('link', { name: 'Acoustic studies', exact: true }).click();
  await preview.getByRole('link', { name: 'Room acoustics', exact: true }).click();
  await preview.getByRole('link', { name: 'Comparing two room positions', exact: true }).click();
  await expect(preview.getByRole('heading', { name: 'Method', exact: true })).toBeVisible();
  await expect(preview.locator('audio')).toBeVisible(); await expect(preview.locator('video')).toBeVisible();
  const frame = page.frames().find(f => f.url().includes('/entries/'));
  await expect.poll(() => frame.locator('video').evaluate(el => el.readyState)).toBeGreaterThanOrEqual(1);
  expect(await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(240, 244, 248)');
  await frame.evaluate(() => document.fonts.ready);
  expect(await frame.evaluate(() => document.fonts.check('16px "Source Serif 4"'))).toBeTruthy();
  const reader = await page.context().newPage();
  await reader.goto(frame.url()); await reader.evaluate(() => document.fonts.ready);
  await reader.locator('video').evaluate(el => { el.currentTime = 0.1; });
  await expect.poll(() => reader.locator('video').evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
  await reader.screenshot({ path: '.local/screenshots/published-research-record.png', fullPage: true });
  await reader.close();
  await page.getByLabel('I have reviewed').check();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download website ZIP', exact: true }).click();
  const zip = await readFile(await (await downloading).path());
  for (const text of ['Acoustic studies', 'Room acoustics', 'A place for scientific and artistic investigation.', 'fonts/space-grotesk.ttf', 'fonts/source-serif.ttf', '.mp4', '.wav', '.png']) expect(zip.toString()).toContain(text);
  expect(zip.toString()).not.toContain('PRIVATE_MEDIA_SOURCE'); expect(zip.toString()).not.toContain(root);
  const saved = await new Workspace(root).read();
  expect(saved.book.projects).toHaveLength(2);
  expect(saved.book.entries.find(e => e.title === 'Comparing two room positions').attachments).toHaveLength(3);
  expect(errors).toEqual([]);
});


test('laboratory sample-to-review workflow prints a revision and requires amendment before correction', async ({ page, context }) => {
  await new Workspace(root).create(sampleNotebook());
  await page.goto(app.url);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await navigate(page,'Preferences');await preferences(page,'Modules');
  await page.locator('[data-desk-module="laboratory"]').check();
  await page.waitForFunction(()=>!document.querySelector('#desk-save-state')?.textContent);
  await page.goto(new URL('#/laboratory/samples',app.url).href);
  await page.getByRole('button',{name:'Register sample',exact:true}).click();
  await page.getByLabel('Sample code',{exact:true}).fill('S-2026-01');
  await page.getByLabel('Material / specimen',{exact:true}).fill('Synthetic water');
  await page.getByLabel('Source reference (optional)').fill('SYNTHETIC_PRIVATE_REFERENCE');
  await page.getByRole('dialog').getByRole('button',{name:'Register sample',exact:true}).click();
  await page.getByRole('button',{name:'Record analysis',exact:true}).click();
  await page.getByLabel('Analysis code',{exact:true}).fill('A-2026-01');
  await page.getByLabel('Method / version',{exact:true}).fill('Optical method v1');
  await page.getByLabel('Analyte',{exact:true}).fill('Absorbance');
  await page.getByLabel('Result value',{exact:true}).fill('0.34');
  await page.getByLabel('Unit (required for numeric results)').fill('AU');
  await page.getByLabel('Lower interval limit (optional)').fill('0');
  await page.getByLabel('Upper interval limit (optional)').fill('1');
  await page.getByRole('button',{name:'Save analysis',exact:true}).click();
  await page.getByRole('button',{name:'A-2026-01',exact:true}).click();
  await page.getByRole('button',{name:'Save and submit for review',exact:true}).click();
  await page.getByRole('button',{name:'A-2026-01',exact:true}).click();
  await page.getByRole('button',{name:'Review result',exact:true}).click();
  await page.getByLabel('Reviewer name',{exact:true}).fill('Synthetic reviewer');
  await page.getByLabel('Review comment (required for correction)').fill('Evidence and units checked.');
  await page.getByLabel('I checked sample identity').check();
  await page.getByRole('button',{name:'Record review',exact:true}).click();
  await page.getByRole('button',{name:/^Analyses /}).click();
  await expect(page.getByRole('cell',{name:'Approved',exact:true})).toBeVisible();
  await page.screenshot({path:'.local/screenshots/laboratory-results.png',fullPage:true});
  await page.getByRole('button',{name:'A-2026-01',exact:true}).click();
  await expect(page.getByLabel('Result value',{exact:true})).toHaveCount(0);
  const popup=context.waitForEvent('page');
  await page.getByRole('link',{name:'Open printable result',exact:true}).click();
  const sheet=await popup;await sheet.waitForLoadState();
  await expect(sheet.getByRole('heading',{name:'Result sheet',exact:true})).toBeVisible();
  await expect(sheet.getByRole('cell',{name:'0.34',exact:true})).toBeVisible();
  await sheet.emulateMedia({media:'print'});
  await sheet.screenshot({path:'.local/screenshots/result-sheet.png',fullPage:true});
  const oldSheet=sheet.url();await sheet.close();
  await page.getByRole('button',{name:'Amend result',exact:true}).click();
  await page.getByLabel('Reason for amendment').fill('Correct a transcription.');
  await page.getByRole('button',{name:'Start amendment',exact:true}).click();
  await expect(page.getByLabel('Result value',{exact:true})).toHaveValue('0.34');
  const retained=await page.request.get(oldSheet);
  expect(retained.status()).toBe(200);
  expect(await retained.text()).toContain('<td>0.34</td>');
  await page.getByLabel('Result value',{exact:true}).fill('0.35');
  await page.getByRole('button',{name:'Save result',exact:true}).click();
  await navigate(page,'Website editor');await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  await expect(page.frameLocator('iframe[title="Publication preview"]').locator('body')).not.toContainText('SYNTHETIC_PRIVATE_REFERENCE');
  expect(errors).toEqual([]);
});

test('logos at workspace, project, notebook, page and record scopes survive save and appear in the correct static pages', async ({ page }) => {
  test.setTimeout(60000);
  const fixtures=await mediaFixtures(await mkdtemp(path.join(os.tmpdir(),'observanda-branding-')));
  const book=sampleNotebook(), custom={id:crypto.randomUUID(),title:'About the laboratory',body:'Independent work.',share:true};
  book.pages.push(custom);await new Workspace(root).create(book);
  await page.goto(app.url);
  await preferences(page,'Appearance');
  await page.getByRole('button',{name:'Logos & branding',exact:true}).click();
  const targets=[['home','Workspace emblem'],['project:'+book.projects[0].id,'Project emblem'],['notebook:'+book.notebooks[0].id,'Lab book emblem'],['page:'+custom.id,'About emblem'],['entry:'+book.entries[0].id,'Record emblem']];
  for(const [target,alt] of targets){
    if(target.startsWith('entry:')){await page.getByLabel('Branding scope',{exact:true}).selectOption('record-picker');await page.getByRole('dialog').getByLabel('Find in this workspace',{exact:true}).fill(book.entries[0].title);await page.getByRole('dialog').locator('[data-action=research-target-choose]').click();}else await page.getByLabel('Branding scope',{exact:true}).selectOption(target);
    await page.getByLabel('Add logo',{exact:true}).setInputFiles(fixtures.image.file);
    await expect(page.getByLabel('Logo 1 alternative text')).toBeVisible();
    await page.getByLabel('Logo 1 alternative text').fill(alt);
    await page.getByRole('button',{name:'Save branding',exact:true}).click();
    await expect(page.locator('#save-status')).toHaveText('Saved');
  }
  await page.getByLabel('Branding scope',{exact:true}).selectOption('home');
  await page.getByLabel('Add logo',{exact:true}).setInputFiles(fixtures.image.file);
  await expect(page.getByLabel('Logo 2 alternative text')).toBeVisible();
  await page.getByLabel('Logo 2 alternative text').fill('Partner emblem');
  await page.getByRole('button',{name:'Save branding',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.screenshot({path:'.local/screenshots/scoped-branding.png',fullPage:true});
  await navigate(page,'Website editor');await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  const frame=page.frameLocator('iframe[title="Publication preview"]');
  await expect(frame.getByRole('img',{name:'Workspace emblem',exact:true})).toBeVisible();
  await expect(frame.getByRole('img',{name:'Partner emblem',exact:true})).toBeVisible();
  for(const [target,alt] of targets.slice(1)){
    const [type,id]=target.split(':');const directory={project:'projects',notebook:'notebooks',page:'pages',entry:'entries'}[type];
    await page.getByLabel('Preview page',{exact:true}).selectOption(`${directory}/${id}.html`);
    await expect(frame.getByRole('img',{name:alt,exact:true})).toBeVisible();
  }
  const saved=await new Workspace(root).read();expect(saved.book.branding).toHaveLength(5);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('publishing destination persists privately and review identifies the configured SSH target', async ({ page }) => {
  await new Workspace(root).create(sampleNotebook());await page.goto(app.url);
  await preferences(page,'Integrations');
  await page.getByLabel('Publish with',{exact:true}).selectOption('ssh');
  await page.getByLabel('SSH hostname',{exact:true}).fill('hosting.example');
  await page.getByLabel('SSH user',{exact:true}).fill('research');
  await page.getByLabel('Dedicated hosting directory',{exact:true}).fill('/srv/observanda');
  await page.getByLabel('Public website URL (HTTPS)',{exact:true}).fill('https://research.example/');
  await page.getByRole('button',{name:'Save destination',exact:true}).click();
  await expect(page.locator('#destination-status')).toHaveText('Destination saved on this device.');
  await page.reload();await preferences(page,'Integrations');
  await expect(page.getByLabel('SSH hostname',{exact:true})).toHaveValue('hosting.example');
  await page.screenshot({path:'.local/screenshots/publishing-settings.png',fullPage:true});
  await navigate(page,'Publishing');await page.getByRole('button',{name:'Review website',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  await expect(page.locator('main')).toContainText('Destination: hosting.example / /srv/observanda/current');
  await page.getByRole('button',{name:'Publish to SSH hosting',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('Review the website');
  await expect(page.frameLocator('iframe[title="Publication preview"]').locator('body')).not.toContainText('hosting.example');
});


test('themes style the whole workspace and can be saved, renamed, updated, reapplied and deleted', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error'&&!/^Blocked script execution in .*\/preview\/.*because the document's frame is sandboxed/.test(message.text())) errors.push(message.text()); });
  await new Workspace(root).create(sampleNotebook());
  await page.goto(app.url);
  await preferences(page,'Appearance');
  await page.getByRole('button', { name:/^Studio/ }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.nav-button.active')).toHaveCSS('color', 'rgb(33, 110, 105)');
  await page.locator('[data-appearance="accent"]').fill('#5832a8');
  await expect(page.locator('.nav-button.active')).toHaveCSS('color', 'rgb(88, 50, 168)');
  await page.getByLabel('Published cards', {exact:true}).selectOption('list');
  await page.getByLabel('Corner radius', {exact:false}).fill('4');
  await expect(page.frameLocator('#design-preview').locator('body')).toHaveClass('studio cards-list header-band navigation-top heading-split');
  await expect(page.frameLocator('#design-preview').locator('.publication-card').first()).toHaveCSS('border-radius', '4px');
  await page.getByRole('button', {name:'Save as new theme'}).click();
  const themeName = 'Microscopy \u03b1 / <north> & "light"';
  await page.getByLabel('Theme name', {exact:true}).fill(themeName);
  await page.getByRole('button', {name:'Save theme', exact:true}).click();
  await expect(page.locator('#theme-status')).toHaveText(themeName + ' / saved preset');
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();
  await preferences(page,'Appearance');
  await expect(page.locator('#theme-status')).toHaveText(themeName + ' / saved preset');
  await expect(page.getByLabel('Accent', {exact:true})).toHaveValue('#5832a8');
  await page.getByRole('button', {name:'Rename',exact:true}).click();
  await page.getByLabel('Theme name', {exact:true}).fill('Microscopy / final');
  await page.getByRole('button', {name:'Rename theme',exact:true}).click();
  await expect(page.locator('#theme-status')).toContainText('Microscopy / final');
  await page.getByLabel('Accent', {exact:true}).fill('#334e82');
  await page.getByRole('button', {name:'Update saved theme',exact:true}).click();
  await expect(page.locator('#theme-status')).toHaveText('Microscopy / final / saved preset');
  await page.getByRole('button', {name:/^Research/}).click();
  await expect(page.locator('.nav-button.active')).toHaveCSS('color','rgb(55, 88, 178)');
  await page.getByRole('button', {name:'Apply',exact:true}).click();
  await expect(page.getByLabel('Accent', {exact:true})).toHaveValue('#334e82');
  await expect(page.getByRole('button', {name:'Save appearance',exact:true})).toBeDisabled();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.getByRole('button', {name:'Phone',exact:true}).click();
  await expect(page.locator('#design-preview')).toHaveCSS('width', '390px');
  await mkdir('.local/screenshots', {recursive:true});
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({path:'.local/screenshots/appearance-studio.png'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', {name:'Save as new theme'}).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.getByRole('button', {name:'Cancel',exact:true}).click();
  await page.screenshot({path:'.local/screenshots/appearance-mobile.png',fullPage:true});
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name:'Delete',exact:true}).click();
  await expect(page.locator('#saved-theme')).toHaveCount(0);
  await expect(page.getByLabel('Accent', {exact:true})).toHaveValue('#334e82');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Appearance',exact:true})).toBeVisible();
  await expect(page.locator('#saved-theme')).toHaveCount(0);
  await expect(page.getByLabel('Accent', {exact:true})).toHaveValue('#334e82');
  expect(errors).toEqual([]);
});

test('themes are chosen in Appearance after setup without changing workspace identity or adding starter records',async({page})=>{
 await page.goto(app.url);await page.getByLabel('Workspace name').fill('A new perspective');await page.getByText('Add a description',{exact:false}).click();await page.getByLabel('Workspace description').fill('Research across disciplines.');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 await preferences(page,'Appearance');await page.getByRole('button',{name:/^Studio/}).click();await expect(page.locator('.section-save [data-action=save]')).toBeEnabled();await saveChanges(page);await page.reload();
 await expect(page.getByLabel('Accent',{exact:true})).toHaveValue('#216e69');const saved=(await new Workspace(root,await verifyAccess(await readAccess(root),'','',{deviceStore})).read()).book;expect(saved.title).toBe('A new perspective');expect(saved.description).toBe('Research across disciplines.');expect(saved.projects).toHaveLength(0);expect(saved.notebooks).toHaveLength(0);
});

test('empty websites have a complete isolated design gallery with selectable pages and playable examples', async ({ page }) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const book=sampleNotebook(); book.entries=[]; book.projects.forEach(p=>p.share=false);
  await new Workspace(root).create(book); const before=await new Workspace(root).read();
  await page.goto(app.url); await preferences(page,'Appearance');
  const frame=page.frameLocator('#design-preview');
  await expect(page.getByLabel('Preview content',{exact:true})).toHaveValue('examples');
  await expect(frame.locator('.specimen-banner')).toBeVisible();
  await expect(frame.getByRole('heading',{name:'An example experiment',exact:true,level:1})).toBeVisible();
  await expect(frame.getByRole('table')).toBeVisible();
  expect(await frame.locator('.publication-card').count()).toBeGreaterThanOrEqual(4);
  await expect.poll(()=>frame.locator('audio').evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(()=>frame.locator('video').evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(1);
  for(const kind of ['audio','video']) {
    expect(await frame.locator(kind).evaluate(el=>el.autoplay)).toBeFalsy();
    await frame.locator(kind).evaluate(el=>el.play());
    await expect.poll(()=>frame.locator(kind).evaluate(el=>el.currentTime)).toBeGreaterThan(0);
    await frame.locator(kind).evaluate(el=>el.pause());
  }
  expect(await frame.locator('img').evaluateAll(images=>images.every(el=>el.complete&&el.naturalWidth>0))).toBeTruthy();
  await mkdir('.local/screenshots',{recursive:true});
  await page.screenshot({path:'.local/screenshots/design-gallery-desktop.png'});
  const record='entries/00000000-0000-4000-8000-000000000010.html';
  await page.getByLabel('Preview page',{exact:true}).selectOption(record);
  await expect(frame.locator('.specimen-index')).toHaveCount(0);
  await page.getByLabel('Accent',{exact:true}).fill('#5832a8');
  await expect(frame.locator('body')).toHaveCSS('--accent','#5832a8');
  await expect(page.getByLabel('Preview page',{exact:true})).toHaveValue(record);
  await page.getByLabel('Preview content',{exact:true}).selectOption('website');
  await expect(frame.getByRole('heading',{name:book.title,exact:true})).toBeVisible();
  await expect(frame.locator('.specimen-banner')).toHaveCount(0);
  await expect(frame.locator('body')).not.toContainText('An example experiment');
  await page.getByLabel('Preview content',{exact:true}).selectOption('examples');
  await expect(frame.locator('.specimen-index')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(await frame.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
  await page.locator('#design-preview').scrollIntoViewIfNeeded();
  await expect(frame.locator('.specimen-banner')).toBeVisible();
  await frame.locator('body').evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({path:'.local/screenshots/design-gallery-mobile.png'});
  expect((await new Workspace(root).read()).etag).toBe(before.etag);
  expect(errors).toEqual([]);
});

test('workspace correction preserves research and gives projects, lab books and records stable navigation', async ({ page }) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const book=sampleNotebook(), project=book.projects[0], notebook=book.notebooks[0];
  book.title='Test lab book 1'; project.title='First investigations'; notebook.title='Observations';
  const second={id:crypto.randomUUID(),title:'Test lab book 2',description:'Independent second project.',share:true,logoId:null};
  book.projects.push(second); book.notebooks.push({id:crypto.randomUUID(),projectId:second.id,title:'Notes'});
  await new Workspace(root).create(book); await page.goto(app.url);
  await expect(page.locator('.workspace-name')).toHaveText('Test lab book 1');
  await editWorkspace(page);
  await page.getByLabel('Workspace introduction',{exact:true}).fill('A new introduction.');
  await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('[data-workspace-status]')).toHaveText('Saved');
  expect((await new Workspace(root).read()).book.description).toBe('A new introduction.');
  await editWorkspace(page);await page.getByText('Workspace reference and organization',{exact:true}).click();await page.getByRole('button',{name:'Move workspace details to a project',exact:true}).click();
  await page.getByLabel('New workspace name',{exact:true}).fill('Research collective');
  await page.getByLabel('Destination project',{exact:true}).selectOption(project.id);
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Rename First investigations to');
  expect((await new Workspace(root).read()).book.title).toBe('Test lab book 1');
  await page.getByRole('button',{name:'Apply hierarchy changes',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Research collective');
  const saved=(await new Workspace(root).read()).book;
  expect(saved.projects.find(p=>p.id===project.id).title).toBe('Test lab book 1');
  expect(saved.projects.find(p=>p.id===second.id)).toEqual(second);
  expect(saved.entries).toEqual(book.entries);
  expect(saved.notebooks).toEqual(book.notebooks);
  await mkdir('.local/screenshots',{recursive:true});
  await page.screenshot({path:'.local/screenshots/workspace-hierarchy.png'});
  await page.locator('main').getByRole('button',{name:'Test lab book 1',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('#/projects/'+project.id+'$'));
  await expect(page.getByRole('heading',{name:'Test lab book 1',exact:true})).toBeVisible();
  await page.screenshot({path:'.local/screenshots/project-overview.png'});
  await page.locator('.notebook-grid').getByRole('button',{name:'Observations',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('#/notebooks/'+notebook.id+'$'));
  await page.getByRole('button',{name:'Lab book settings',exact:true}).click();
  await page.getByLabel('Lab book name',{exact:true}).fill('Field journal');
  await page.locator('#dialog').getByLabel('Project',{exact:true}).selectOption(second.id);
  await page.getByRole('button',{name:'Save lab book',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Field journal',exact:true})).toBeVisible();
  const moved=(await new Workspace(root).read()).book;
  expect(moved.notebooks.find(n=>n.id===notebook.id).projectId).toBe(second.id);
  expect(moved.entries.filter(e=>e.notebookId===notebook.id).every(e=>!e.share)).toBeTruthy();
  expect(moved.entries.map(e=>e.id)).toEqual(book.entries.map(e=>e.id));
  await expect(page.getByRole('navigation',{name:'Project hierarchy',exact:true})).toContainText('Test lab book 2');
  await page.getByLabel('Search records',{exact:true}).fill('seed');
  await page.getByLabel('Filter by record type',{exact:true}).selectOption('observation');
  await page.getByRole('button',{name:'Watching a seed unfold',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Project hierarchy',exact:true})).toContainText('Field journal');
  await page.goBack(); await expect(page.getByRole('heading',{name:'Field journal',exact:true})).toBeVisible();
  await expect(page.getByLabel('Search records',{exact:true})).toHaveValue('seed');
  await expect(page.getByLabel('Filter by record type',{exact:true})).toHaveValue('observation');
  await page.goForward(); await expect(page.getByLabel('Record title')).toHaveValue('Watching a seed unfold');
  await page.reload(); await expect(page.getByLabel('Record title')).toHaveValue('Watching a seed unfold');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Field journal',exact:true})).toBeVisible();
  await page.screenshot({path:'.local/screenshots/notebook-navigation.png'});
  await page.setViewportSize({width:390,height:844});

  await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('navigation',{name:'Publishing',exact:true})).toBeVisible();
  await navigate(page,'Website editor');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});


test('setup chooses a storage folder and optional credentials, then enforces lock and unlock',async({page})=>{
  await app.close();app=await startServer({root,port:0,headless:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const destination=path.join(root,'chosen workspace'),password='synthetic browser password';
  await page.goto(app.url);await page.getByLabel('Workspace name').fill('Research archive');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Browse server folders',exact:true}).click();
  await page.getByText('Go to a path or network share',{exact:true}).click();await page.getByLabel('Folder or mounted share').fill(root);await page.getByRole('button',{name:'Go to folder',exact:true}).click();
  await page.getByRole('button',{name:'Use this folder',exact:true}).click();
  await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(root);
  await page.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await page.getByRole('button',{name:'Check folder',exact:true}).click();await expect(page.locator('.storage-check-result')).toContainText('Ready for a new workspace');
  await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('Confirm password',{exact:true}).fill('different password');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.setup-error')).toContainText('do not match');
  await page.getByLabel('Confirm password',{exact:true}).fill(password);
  await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:test.info().outputPath('setup-storage.png'),fullPage:true});
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Research archive');
  await preferences(page,'Storage & access');
  await expect(page.locator('main')).toContainText(destination);await expect(page.locator('.storage-map')).toContainText('Original media');
  await page.screenshot({path:test.info().outputPath('storage-settings.png'),fullPage:true});
  const saved=await new Workspace(destination,await verifyAccess(await readAccess(destination),'',password)).read();expect(saved.book.projects).toHaveLength(0);expect(saved.book.notebooks).toHaveLength(0);
  expect(JSON.stringify(saved.book)).not.toContain(password);expect(JSON.stringify(saved.book)).not.toContain(destination);
  await page.locator('main').getByRole('button',{name:'Lock workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  expect((await page.request.get(app.origin+'/api/notebook')).status()).toBe(401);
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await page.getByLabel('Password',{exact:true}).fill('wrong');
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('#notice')).toContainText('incorrect');
  await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Research archive');
  await preferences(page,'Storage & access');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:test.info().outputPath('storage-mobile.png'),fullPage:true});expect(errors).toEqual([]);
});

test('storage settings copy a reviewed workspace, remember it and open existing workspaces without altering the original',async({page})=>{
  await new Workspace(root).create(sampleNotebook());const before=await new Workspace(root).read();
  const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-browser-copy-')),destination=path.join(parent,'relocated'),preferencesFile=path.join(parent,'settings','preferences.json');
  await app.close();app=await startServer({root,port:0,preferencesFile,headless:true});await page.goto(app.url);
  await preferences(page,'Storage & access');
  await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await expect(page.getByRole('dialog')).toContainText('The original stays in its current folder');
  await page.getByRole('button',{name:'Copy and use this folder',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('A closer look');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect((await new Workspace(root).read()).etag).toBe(before.etag);expect((await new Workspace(destination).read()).etag).toBe(before.etag);
  expect(JSON.parse(await readFile(preferencesFile,'utf8')).workspace).toBe(destination);
  await preferences(page,'Storage & access');await expect(page.locator('main')).toContainText(destination);
  await page.getByRole('button',{name:'Open another workspace',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(root);
  await page.getByRole('button',{name:'Browse server folders',exact:true}).click();await page.getByRole('button',{name:'Use this folder',exact:true}).click();
  await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(root);
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('.workspace-name')).toHaveText('A closer look');
  await preferences(page,'Storage & access');await expect(page.locator('main')).toContainText(root);
  await page.reload();await expect(page.getByRole('heading',{name:'Storage & access',exact:true})).toBeVisible();
});

test('an unavailable remembered folder offers recovery instead of first-run creation',async({page})=>{
  await app.close();app=await startServer({root:path.join(root,'missing-share'),port:0,expectedExisting:true});await page.goto(app.url);
  await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create workspace',exact:true})).toHaveCount(0);
  await new Workspace(root).create(sampleNotebook());
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(root);await page.getByRole('dialog').getByRole('button',{name:'Open workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('A closer look');
});
import {chooseFont} from './font-helper.js';
