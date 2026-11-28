import {readWebsiteZip} from '../../src/website-import.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {contentBuffer} from '../../src/file-content.js';
import {answerConfirmation} from './confirm-helper.js';
import {sessionRequest} from './session-fixture.js';
import {navigate,preferences,editWorkspace,openDefaultWebsite,workspaceCommands} from './preferences-helper.js';
import {TestDeviceStore as DeviceStore} from '../device-fixture.js';
import {readAccess,verifyAccess,createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {initializeLocation} from '../../src/locations.js';
import {clearVault} from '../../src/encryption.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookRegistry} from '../../src/lab-book-registry.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import { test, expect } from '@playwright/test';
import {pagePanel} from './website-page-panel-helper.js';
import { mediaFixtures } from '../media-fixtures.js';
import {mediaToolsAvailable} from '../media-tools.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer as startServer} from '../device-fixture.js';
import { Workspace } from '../../src/storage.js';
import { sampleNotebook } from '../../src/sample.js';
import {newRecordOpened,setNewRecordTitle,openRecordWriting,openRecordDetail,saveRecordValue,saveNewRecord} from './record-editing-helper.js';
import {revealInEditor} from './record-editor-helper.js';
import {figureDialog,figureArea,addFigureItem,setFigureProperty} from './figure-authoring-controls.js';

let app, root, parent, deviceStore, databaseOwner, detachDatabase, workspaceVault;
const serverOptions=()=>({root,port:0,headless:true,deviceStore,preferencesFile:path.join(parent,'preferences.json')});
async function independentDatabases(){
  await app.close();
  databaseOwner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:crypto.randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});
  detachDatabase=installDatabaseProvider(databaseOwner);
  app=await startServer(serverOptions());
}
async function encryptedSample(book=sampleNotebook()){
  await app.close();
  const access=await createWorkspaceAccess('','',deviceStore);workspaceVault=takeCreatedVault(access);
  await initializeLocation(root,book,access,workspaceVault);app=await startServer(serverOptions());
}
async function createdWorkspace(name){root=path.join(parent,name);workspaceVault=await verifyAccess(await readAccess(root),'','',{deviceStore});}
// A new record is written on the record page: its summary, sections and values each in their own dialog.
async function writeSummary(page,text){const dialog=await openRecordWriting(page);await dialog.locator('.ProseMirror').fill(text);await saveRecordValue(dialog);}
async function writeSection(page,title,text){
  await page.locator('main .record-sections > section').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Edit section',exact:true}).click();
  const dialog=page.locator('dialog.record-writing[open]');await expect(dialog.locator('.ProseMirror')).toBeVisible();await dialog.locator('.ProseMirror').fill(text);await saveRecordValue(dialog);
}
async function shareOnWebsites(page){await page.locator('.record-editing [data-record-publication] [data-value-field="share"]').click();const dialog=page.locator('dialog.record-writing[open]');await dialog.locator('[data-record-value]').selectOption('true');await saveRecordValue(dialog);}
test.beforeEach(async () => { parent=await mkdtemp(path.join(os.tmpdir(),'observanda-browser-'));root=path.join(parent,'A closer look');deviceStore=new DeviceStore({file:path.join(parent,'device.key')});app=await startServer(serverOptions()); });
test.afterEach(async () => {
  try{await app.close();}finally{try{await databaseOwner?.close();}finally{detachDatabase?.();databaseOwner=detachDatabase=null;await clearVault(workspaceVault);workspaceVault=null;}}
  expect(path.dirname(parent)).toBe(path.resolve(os.tmpdir()));expect(path.basename(parent)).toMatch(/^observanda-browser-/);
  await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});
});

test('create, edit, persist, customize, review, and download an independent notebook', async ({ page }) => {
  test.setTimeout(120000);page.setDefaultTimeout(15000);await independentDatabases();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url);
  await page.getByLabel('Workspace name').fill('Garden experiments');
  await page.getByText('Add a description',{exact:false}).click();await page.getByLabel('Workspace description').fill('Questions from the windowsill.');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Use this device',{exact:false}).check();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.locator('.workspace-name')).toHaveText('Garden experiments',{timeout:60000});await createdWorkspace('Garden experiments');
  await navigate(page,'Projects');
  await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Garden project');await page.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Garden project',exact:true,level:1})).toBeVisible({timeout:60000});
  await page.locator('main').getByRole('button',{name:'New lab book',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Lab book name',{exact:true}).fill('Garden observations');
  await page.getByRole('dialog').getByRole('button',{name:'Save lab book',exact:true}).click();
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Create observation', exact: true }).click();
  await newRecordOpened(page);await setNewRecordTitle(page,'First green leaves');
  await writeSummary(page,'Two leaves opened today.\nThe soil was still damp.');
  await shareOnWebsites(page);
  await (await revealInEditor(page,page.getByRole('button',{name:'Add figure',exact:true}),'Evidence and results')).click();
  const figure=figureDialog(page);await expect(figure.locator('[data-authored-editor]')).toBeVisible();
  for(const [x,y] of [['1','3'],['2','8']]){await figureArea(figure,'points');await addFigureItem(page,figure);await setFigureProperty(page,figure,'x',x);await setFigureProperty(page,figure,'y',y);}
  await saveRecordValue(figure,{timeout:60000});
  let releaseCommit;const commitGate=new Promise(resolve=>{releaseCommit=resolve;});
  const applyRoute='**/api/**/research/drafts/review/apply';
  await page.context().route(applyRoute,async route=>{await commitGate;await route.continue();},{times:1});
  try{
    const committing=page.waitForRequest(applyRoute);
    await page.getByRole('button',{name:'Save record',exact:true}).click();
    await committing;
    // While the record is being saved it cannot be saved again or discarded, and what was written stays shown.
    await expect(page.locator('.record-toolbar [role=status]')).toHaveText('Saving the record…');
    await expect(page.getByRole('button',{name:'Save record',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Discard record',exact:true})).toBeDisabled();
    await expect(page.locator('main h1').first()).toHaveText('First green leaves');
  }finally{releaseCommit();}
  // The save has finished once the saved record's page replaces the new record's.
  await expect(page.getByRole('button',{name:'Save record',exact:true})).toHaveCount(0,{timeout:60000});
  await expect(page.locator('.record-editing')).toContainText('Two leaves opened today.',{timeout:15000});
  await page.context().unroute(applyRoute);
  await page.reload();await expect(page.locator('.record-reader')).toContainText('Two leaves opened today.');
  await navigate(page,'Dashboard');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  let releasePolicy,policyArrived;const policyGate=new Promise(resolve=>{releasePolicy=resolve;}),oldOwnerLoading=new Promise(resolve=>{policyArrived=resolve;});
  const ownedPolicy='**/api/projects/*/lab-books/*/media-policy';
  await page.context().route(ownedPolicy,async route=>{const response=await route.fetch();policyArrived();await policyGate;await route.fulfill({response}).catch(()=>{});},{times:1});
  try{
    await page.goBack();await oldOwnerLoading;
    await navigate(page,'Dashboard');await navigate(page,'All records');
    await expect(page.getByRole('heading',{name:'All records',exact:true})).toBeVisible();
  }finally{releasePolicy();await page.context().unroute(ownedPolicy);}
  await expect(page).toHaveURL(/#\/records$/);
  await expect(page.getByRole('heading',{name:'Observanda could not finish opening',exact:true})).toHaveCount(0);
  const ownerReads=[];const trackOwnerRead=request=>{if(/\/lab-books\/[^/]+\/workspace\/read\/start$/.test(request.url()))ownerReads.push(request.url());};page.on('request',trackOwnerRead);
  await page.getByRole('link', { name: 'First green leaves',exact:true }).click();
  await expect(page.locator('.record-reader')).toContainText('Two leaves opened today.');
  await expect(page.locator('.record-reader')).toContainText('The soil was still damp.');
  page.off('request',trackOwnerRead);expect(ownerReads).toHaveLength(1);
  // Lab book records reach a website through a records list placed on its page.
  await navigate(page,'Website editor');
  const files=page.locator('[data-website-files-app]'),siteCanvas=page.frameLocator('#website-files-canvas'),feedDialog=page.locator('dialog[data-website-feed-dialog]');
  await pagePanel(page,'Add');await files.getByRole('button',{name:/^Lab book records/}).click();await expect(feedDialog).toBeVisible();
  await feedDialog.locator('[data-feed-heading]').fill('Garden notes');await feedDialog.locator('[data-feed-apply]').click();await expect(feedDialog).not.toBeVisible({timeout:30000});
  await expect(siteCanvas.locator('section[data-website-feed]')).toContainText('First green leaves');
  // Applying the list saves the page; a remaining edit is saved here.
  const saveSite=files.getByRole('button',{name:'Save website',exact:true});if(await saveSite.isEnabled())await saveSite.click();await expect(files.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await navigate(page,'Dashboard');
  await navigate(page,'Website editor');
  const downloadEvent=page.waitForEvent('download');await (await publishPanel(page)).getByRole('button',{name:'Download website ZIP',exact:true}).click();
  const download=await downloadEvent;
  const zip = await readFile(await download.path());
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.toString('utf8')).toContain('First green leaves');
  expect(zip.toString('utf8')).not.toContain(root);
  expect(errors).toEqual([]);
});

test('private-path detection blocks website export and names no private path', async ({ page }) => {
  test.setTimeout(90000);
  await encryptedSample(sampleNotebook());
  await page.goto(app.url);
  await navigate(page,'Website editor');
  const files=page.locator('[data-website-files-app]');
  // A private folder path typed into a page is saved, but the website is never exported with it.
  await files.getByRole('button',{name:'Page code (HTML)',exact:true}).click();const html=page.getByRole('textbox',{name:'Page code (HTML)',exact:true});
  await html.fill((await html.inputValue()).replace('</body>','<p>/home/imaginary-person/private-log</p></body>'));
  await files.getByRole('button',{name:'Save website',exact:true}).click();await expect(files.locator('[data-website-files-status]')).toHaveText('Website saved.');
  let downloaded=false;page.on('download',()=>{downloaded=true;});
  await (await publishPanel(page)).getByRole('button',{name:'Download website ZIP',exact:true}).click();
  // The export is checked first and refused with an explanation; nothing is downloaded and the path is never shown.
  const status=files.locator('[data-website-files-status]');await expect(status).toHaveAttribute('role','alert',{timeout:30000});
  await expect(status).not.toContainText('imaginary-person');expect(downloaded).toBe(false);
});

test('a save in flight holds the writing editor until it is stored, then shows the saved text', async ({ page }) => {
  await encryptedSample(sampleNotebook());
  await page.goto(app.url);
  await navigate(page,'All records');
  const open=()=>page.locator('.records-table').getByRole('link',{name:'Watching a seed unfold',exact:true}).or(page.locator('.records-table').getByRole('button',{name:'Watching a seed unfold',exact:true})).first().click();
  await open();await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.getByRole('button',{name:'Edit summary / context',exact:true}).click();
  const dialog=page.locator('dialog[open]').last(),editor=dialog.locator('.ProseMirror');
  await editor.fill('First draft while the save waits');
  let release;const waiting=new Promise(resolve=>{release=resolve;});const saveRoute='**/research/records/writing/save';
  await page.context().route(saveRoute,async route=>{await waiting;await route.continue();},{times:1});
  const sent=page.waitForRequest(saveRoute);
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await sent;
  // While the save is on its way the editor cannot take new typing that the save would not include.
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  expect(await editor.evaluate(node=>!node.isContentEditable||!!node.closest('fieldset:disabled,[inert]'))).toBe(true);
  release();
  await expect(dialog).not.toBeVisible({timeout:30000});
  await expect(page.locator('main')).toContainText('First draft while the save waits');
  await page.reload();await navigate(page,'All records');await open();
  await expect(page.locator('main')).toContainText('First draft while the save waits');
});

test('desktop and mobile layouts remain usable with real sample content', async ({ page }) => {
  await encryptedSample(sampleNotebook());
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact:true })).toBeVisible();
  await page.screenshot({ path:test.info().outputPath('notebook-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });

  await navigate(page,'All records');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('link',{name:'Watching a seed unfold',exact:true}).or(page.getByRole('button',{name:'Watching a seed unfold',exact:true})).first().click();
  await expect(page.locator('.record-reader h1')).toHaveText('Watching a seed unfold');
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(page.getByLabel('Summary / context',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path:test.info().outputPath('notebook-mobile.png'), fullPage: true });
});


test('a new entry defaults to the author local calendar date', async ({ browser }) => {
  const sample=sampleNotebook();await encryptedSample(sample);
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-09-26T01:00:00Z'));
    await page.goto(app.url);
    await page.goto(new URL('#/notebooks/'+sample.notebooks[0].id,app.url).href);
    await page.getByRole('button', { name: 'New record', exact: true }).click();
    await page.getByRole('button', { name: 'Create observation', exact: true }).click();
    await newRecordOpened(page);const date=await openRecordDetail(page,'occurredOn');
    await expect(date.getByLabel('Record date',{exact:true})).toHaveValue('2026-09-25');
  } finally { await context.close(); }
});


test('build a project with structured research and playable media, place it on a website with a page of its own, and export it', async ({ page }) => {
  test.setTimeout(180000);page.setDefaultTimeout(15000);
  await independentDatabases();
  test.skip(!(await mediaToolsAvailable()), 'FFmpeg and ffprobe are required for media tests.');
  const fixtures = await mediaFixtures(await mkdtemp(path.join(parent, 'media-fixtures-')));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await encryptedSample();
  await page.goto(app.url);
  await navigate(page,'Projects');
  await page.locator('main').getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Acoustic studies');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acoustic studies', exact: true,level:1 })).toBeVisible({timeout:60000});
  await page.locator('main').getByRole('button', { name: 'New lab book', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Lab book name', { exact: true }).fill('Room acoustics');
  await page.getByRole('button', { name: 'Save lab book', exact: true }).click();
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Create experiment', exact: true }).click();
  await newRecordOpened(page);await setNewRecordTitle(page,'Comparing two room positions');
  await writeSummary(page,'A controlled listening experiment.');
  await writeSection(page,'Question and objectives','Does the recording position change the observed decay?');
  await writeSection(page,'Method','Use the same source and repeat both positions.');
  const upload=await revealInEditor(page,page.locator('main [data-upload="record-attachment"]'),'Evidence and results');
  for (const [index, kind] of ['image', 'audio', 'video'].entries()) {
    await expect(upload).toBeEnabled();await upload.setInputFiles(fixtures[kind].file);
    const item = page.locator('main [data-record-media]').nth(index);
    await expect(item).toBeVisible({ timeout: 20000 });
    await item.locator('[data-value-field^="media:"]').click();
    const details=page.getByRole('dialog',{name:'Edit media details',exact:true});
    await details.getByLabel('Caption', { exact: true }).fill(`Synthetic ${kind} evidence`);
    await details.getByLabel('Make this media available for website publication',{exact:true}).check();
    if (kind !== 'image') await details.getByLabel('Transcript / extended description', { exact: true }).fill('Synthetic test recording.');
    await saveRecordValue(details);
    if (kind !== 'image') {
      const player=page.locator('main [data-record-media]').nth(index).locator(kind);
      // The record page's players load nothing until played (preload none); playing loads the file.
      await player.evaluate(el => el.play().catch(error=>{if(error.name!=='AbortError')throw error;}));
      await expect.poll(() => player.evaluate(el => el.readyState)).toBeGreaterThanOrEqual(1);
      await expect.poll(() => player.evaluate(el => el.currentTime)).toBeGreaterThan(0);
    }
  }
  await shareOnWebsites(page);
  await saveNewRecord(page);
  await expect(page.locator('.record-editing, .record-reader').first()).toContainText('Comparing two room positions',{timeout:60000});
  await page.screenshot({ path:test.info().outputPath('research-editor.png'), fullPage: true });
  // The website places the record through a records list and has a page of its own.
  await navigate(page,'Website editor');
  const files=page.locator('[data-website-files-app]'),canvas=page.frameLocator('#website-files-canvas'),feedDialog=page.locator('dialog[data-website-feed-dialog]');
  await pagePanel(page,'Add');await files.getByRole('button',{name:/^Lab book records/}).click();await expect(feedDialog).toBeVisible();
  await feedDialog.locator('[data-feed-heading]').fill('Acoustic studies');await feedDialog.locator('[data-feed-apply]').click();await expect(feedDialog).not.toBeVisible({timeout:30000});
  await expect(canvas.locator('section[data-website-feed]')).toContainText('Comparing two room positions');
  await files.getByRole('button',{name:'Add page',exact:true}).click();await files.getByLabel('Page title',{exact:true}).fill('About this work');
  await files.locator('[data-website-files-form] button[type=submit]').click();
  await expect(canvas.locator('h1')).toHaveText('About this work',{timeout:30000});
  await files.locator('.element-card[data-block="paragraph"]').click();
  const paragraph=canvas.locator('main p, body > p').last();await paragraph.click();await paragraph.click({clickCount:3});await page.keyboard.type('A place for scientific and artistic investigation.');await expect(paragraph).toHaveText('A place for scientific and artistic investigation.');
  await files.getByRole('button',{name:'Save website',exact:true}).click();await expect(files.locator('[data-website-files-status]')).toHaveText('Website saved.');
  // A new page is private until its inclusion is reviewed.
  await pagePanel(page,'Website pages');
  await files.getByRole('button',{name:'Review inclusion',exact:true}).click();
  await page.getByRole('region',{name:'Review publication changes'}).getByRole('button',{name:'Include in next publication'}).click();
  await files.getByRole('button',{name:'Back to the page',exact:true}).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const downloading = page.waitForEvent('download');
  await (await publishPanel(page)).getByRole('button', { name: 'Download website ZIP', exact: true }).click();
  const zip = await readFile(await (await downloading).path());
  // Read the archive as files: page text is compressed inside it.
  const archive=readWebsiteZip(zip),text=archive.filter(entry=>/\.html$/.test(entry.name)).map(entry=>entry.bytes.toString('utf8')).join(' '),names=archive.map(entry=>entry.name).join(' ');
  for (const value of ['Comparing two room positions', 'A place for scientific and artistic investigation.']) expect(text).toContain(value);
  for (const extension of ['.mp4', '.wav', '.png']) expect(names).toContain(extension);
  expect(zip.toString()).not.toContain('PRIVATE_MEDIA_SOURCE'); expect(zip.toString()).not.toContain(root);
  await navigate(page,'Dashboard');
  const workspace=new Workspace(root,workspaceVault),saved=await workspace.read(),registered=(await new ProjectRegistry(workspace,saved.book.id).read()).value.projects;
  expect(saved.book.projects.length+registered.length).toBe(2);
  const owned=registered.find(project=>project.summary.title==='Acoustic studies'),projectKey=await verifyAccess(await readAccess(owned.root),'','',{deviceStore});
  try{
    const project=new ProjectStorage(owned.root,owned.projectId,projectKey),books=new LabBookRegistry(project),room=(await books.list()).items.find(book=>book.directory==='Room acoustics');
    const bookKey=await verifyAccess(await readAccess(room.root),'','',{deviceStore});
    try{expect((await new LabBookStorage(room.root,room.labBookId,bookKey).read()).book.entries.find(e=>e.title==='Comparing two room positions').attachments).toHaveLength(3);}finally{clearVault(bookKey);}
    expect((await project.read()).book.entries).toHaveLength(0);expect(saved.book.entries.some(e=>e.title==='Comparing two room positions')).toBe(false);
  }finally{clearVault(projectKey);}
  expect(errors).toEqual([]);
});


test('laboratory sample-to-review workflow prints a revision and requires amendment before correction', async ({ page, context }) => {
  await encryptedSample(sampleNotebook());
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
  await page.screenshot({path:test.info().outputPath('laboratory-results.png'),fullPage:true});
  await page.getByRole('button',{name:'A-2026-01',exact:true}).click();
  await expect(page.getByLabel('Result value',{exact:true})).toHaveCount(0);
  const popup=context.waitForEvent('page');
  await page.getByRole('link',{name:'Open printable result',exact:true}).click();
  const sheet=await popup;await sheet.waitForLoadState();
  await expect(sheet.getByRole('heading',{name:'Result sheet',exact:true})).toBeVisible();
  await expect(sheet.getByRole('cell',{name:'0.34',exact:true})).toBeVisible();
  await sheet.emulateMedia({media:'print'});
  await sheet.screenshot({path:test.info().outputPath('result-sheet.png'),fullPage:true});
  const oldSheet=sheet.url();await sheet.close();
  await page.getByRole('button',{name:'Amend result',exact:true}).click();
  await page.getByLabel('Reason for amendment').fill('Correct a transcription.');
  await page.getByRole('button',{name:'Start amendment',exact:true}).click();
  await expect(page.getByLabel('Result value',{exact:true})).toHaveValue('0.34');
  const retained=await sessionRequest(page,'get',oldSheet);
  expect(retained.status()).toBe(200);
  expect(await retained.text()).toContain('<td>0.34</td>');
  await page.getByLabel('Result value',{exact:true}).fill('0.35');
  await page.getByRole('button',{name:'Save result',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('cell',{name:'0.35 AU',exact:true})).toBeVisible();
  // A sample's private source never reaches a website.
  await navigate(page,'Website editor');await openDefaultWebsite(page);
  await expect(page.frameLocator('#website-files-canvas').locator('body')).not.toContainText('SYNTHETIC_PRIVATE_REFERENCE');
  expect(errors).toEqual([]);
});

test('website logos set in page settings reach a Logos block, published from the website files', async ({ page }) => {
  test.setTimeout(150000);
  const fixtures=await mediaFixtures(await mkdtemp(path.join(parent,'site-logos-')));
  await encryptedSample();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url);await navigate(page,'Website editor');const id=await openDefaultWebsite(page);
  const files=page.locator('[data-website-files-app]'),canvas=page.frameLocator('#website-files-canvas');
  await files.locator('.element-card[data-block="logos"]').click();
  const dialog=page.locator('dialog.website-author-dialog');await expect(dialog.getByRole('heading',{name:'Logos',exact:true})).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'Show the logos of',exact:true}).locator('option')).toHaveText(['This page (automatic)','The website']);
  await dialog.getByRole('combobox',{name:'Show the logos of',exact:true}).selectOption({label:'The website'});
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(canvas.locator('[data-observanda-logos="home"]')).toHaveCount(1);
  await files.getByRole('button',{name:'Save website',exact:true}).click();await expect(files.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await files.getByRole('button',{name:'Website pages',exact:true}).click();
  const logos=files.locator('section.website-page-logos');await expect(logos.getByRole('heading',{name:'Website logos',exact:true})).toBeVisible();
  await logos.getByLabel('Add a logo',{exact:true}).setInputFiles(fixtures.image.file);
  await logos.getByLabel('Image description (alt text)',{exact:true}).fill('Website emblem');
  await files.getByRole('button',{name:'Save page settings',exact:true}).click();
  const store=new WebsiteFileStore(new Workspace(root,workspaceVault));
  await expect.poll(async()=>{const exported=await store.export(id),html=(await contentBuffer(exported.files.get('index.html'))).toString('utf8'),logo=/data-observanda-logos="home"[^>]*><img src="(pictures\/[a-f0-9-]{36}\.png)" alt="Website emblem"><\/div>/.exec(html);return Boolean(logo&&exported.files.has(logo[1])&&!html.includes('<template'));},{timeout:30000}).toBe(true);
  expect(errors).toEqual([]);
});

// A server login is set up once in Integrations; a website then chooses it and
// its own folder in its own publishing destination.
test('a server login is set up once in Integrations and a website publishes to it with its own folder', async ({ page }) => {
  test.setTimeout(90000);await independentDatabases();await encryptedSample();await page.goto(app.url);
  await preferences(page,'Integrations');
  const logins=page.locator('#server-logins');
  await expect(logins).toContainText('No server logins yet.');
  await logins.getByRole('button',{name:'Add server login',exact:true}).click();
  await logins.getByLabel('Connection type',{exact:true}).selectOption('ssh');
  await logins.getByLabel('Name',{exact:true}).fill('Lab server');
  await logins.getByLabel('Server name',{exact:true}).fill('hosting.example');
  await logins.getByLabel('User name',{exact:true}).fill('research');
  await logins.getByRole('button',{name:'Save login',exact:true}).click();
  await expect(logins).toContainText('Lab server');await expect(logins).toContainText('research@hosting.example');
  await expect(page.getByLabel('Publish with',{exact:true})).toHaveCount(0);
  await page.reload();await preferences(page,'Integrations');await expect(page.locator('#server-logins')).toContainText('research@hosting.example');
  // A website chooses the login in its own publishing destination.
  await navigate(page,'Website editor');await openDefaultWebsite(page);
  const form=page.locator('.website-files-publish');
  await (await publishPanel(page)).getByRole('button',{name:'Publish update',exact:true}).click();await page.getByRole('button',{name:'Publishing destination',exact:true}).click();
  await form.getByLabel('Publishing destination').selectOption('ssh');
  await form.getByLabel('Server login').selectOption({label:'Lab server · research@hosting.example'});
  await form.getByLabel("This website's folder on the server").fill('/srv/observanda');
  await form.getByLabel('Public website URL').fill('https://research.example/');
  await form.getByRole('button',{name:'Save destination',exact:true}).click();
  await form.getByRole('button',{name:'Review publication',exact:true}).click();
  await expect(page.locator('[data-website-files-review]')).toContainText('Lab server · research@hosting.example:/srv/observanda/current');
});


test('workspace correction preserves research and gives projects, lab books and records stable navigation', async ({ page }) => {
  test.setTimeout(90000);await independentDatabases();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const book=sampleNotebook(), project=book.projects[0], notebook=book.notebooks[0];
  book.title='Test lab book 1'; project.title='First investigations'; notebook.title='Observations';
  const second={id:crypto.randomUUID(),title:'Test lab book 2',description:'Independent second project.',share:true,logoId:null};
  book.projects.push(second); book.notebooks.push({id:crypto.randomUUID(),projectId:second.id,title:'Notes'});
  root=path.join(parent,book.title);await encryptedSample(book);const original=(await new Workspace(root,workspaceVault).read()).book;await page.goto(app.url);
  await expect(page.locator('.workspace-name')).toHaveText('Test lab book 1');
  await editWorkspace(page);
  await page.getByLabel('Workspace introduction',{exact:true}).fill('A new introduction.');
  await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('[data-workspace-status]')).toHaveText('Saved');
  expect((await new Workspace(root,workspaceVault).read()).book.description).toBe('A new introduction.');
  await editWorkspace(page);await page.getByText('Workspace reference and organization',{exact:true}).click();await page.getByRole('button',{name:'Copy workspace details to a project',exact:true}).click();
  await page.getByLabel('Destination project',{exact:true}).selectOption(project.id);
  await page.getByRole('button',{name:'Review changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Rename First investigations to');
  expect((await new Workspace(root,workspaceVault).read()).book.title).toBe('Test lab book 1');
  await page.getByRole('button',{name:'Apply hierarchy changes',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await editWorkspace(page);await page.getByLabel('Workspace name',{exact:true}).fill('Research collective');await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Research collective',{timeout:60000});root=path.join(parent,'Research collective');
  const saved=(await new Workspace(root,workspaceVault).read()).book;
  expect(saved.projects.find(p=>p.id===project.id).title).toBe('Test lab book 1');
  expect(saved.projects.find(p=>p.id===second.id)).toEqual(second);
  expect(saved.entries).toEqual(original.entries);
  expect(saved.notebooks).toEqual(original.notebooks);
  await page.screenshot({path:test.info().outputPath('workspace-hierarchy.png')});
  await navigate(page,'Projects');await page.locator('main').getByRole('button',{name:'Test lab book 1',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('#/projects/'+project.id+'$'));
  await expect(page.getByRole('heading',{name:'Test lab book 1',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('project-overview.png')});
  await page.locator('.notebook-grid').getByRole('button',{name:'Observations',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('#/notebooks/'+notebook.id+'$'));
  await page.getByRole('button',{name:'Lab book settings',exact:true}).click();
  await page.getByLabel('Lab book name',{exact:true}).fill('Field journal');
  await page.locator('#dialog').getByLabel('Project',{exact:true}).selectOption(second.id);
  await page.getByRole('button',{name:'Save lab book',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Field journal',exact:true})).toBeVisible();
  const moved=(await new Workspace(root,workspaceVault).read()).book;
  expect(moved.notebooks.find(n=>n.id===notebook.id).projectId).toBe(second.id);
  expect(moved.entries.filter(e=>e.notebookId===notebook.id).every(e=>!e.share)).toBeTruthy();
  expect(moved.entries.map(e=>e.id)).toEqual(book.entries.map(e=>e.id));
  await expect(page.getByRole('navigation',{name:'Location',exact:true})).toContainText('Test lab book 2');
  await page.getByLabel('Search records',{exact:true}).fill('seed');
  await page.getByLabel('Filter by record type',{exact:true}).selectOption('observation');
  await page.getByRole('button',{name:'Watching a seed unfold',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Location',exact:true})).toContainText('Field journal');
  await page.goBack(); await expect(page.getByRole('heading',{name:'Field journal',exact:true})).toBeVisible();
  await expect(page.getByLabel('Search records',{exact:true})).toHaveValue('seed');
  await expect(page.getByLabel('Filter by record type',{exact:true})).toHaveValue('observation');
  await page.goForward(); await expect(page.locator('.record-reader h1')).toHaveText('Watching a seed unfold');
  await page.reload(); await expect(page.locator('.record-reader h1')).toHaveText('Watching a seed unfold');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Field journal',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('notebook-navigation.png')});
  await page.setViewportSize({width:390,height:844});

  await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('navigation',{name:'Publishing',exact:true})).toBeVisible();
  await navigate(page,'Website editor');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});


test('setup chooses a storage folder and optional credentials, then enforces lock and unlock',async({page})=>{
  await app.close();app=await startServer({root,port:0,headless:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const destination=path.join(parent,'Research archive'),password='synthetic browser password';
  await page.goto(app.url);await page.getByLabel('Workspace name').fill('Research archive');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Browse server folders',exact:true}).click();
  await page.getByText('Go to a path or network share',{exact:true}).click();await page.getByLabel('Folder or mounted share').fill(parent);await page.getByRole('button',{name:'Go to folder',exact:true}).click();
  await page.getByRole('button',{name:'Use this folder',exact:true}).click();
  await expect(page.getByLabel('Create in',{exact:true})).toHaveValue(parent);
  await page.getByRole('button',{name:'Check folder',exact:true}).click();await expect(page.locator('.storage-check-result')).toContainText('Ready for a new workspace');
  await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('Confirm password',{exact:true}).fill('different password');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.setup-error')).toContainText('do not match');
  await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.screenshot({path:test.info().outputPath('setup-storage.png'),fullPage:true});
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Research archive');
  await workspaceCommands(page);
  await expect(page.locator('main')).toContainText(destination);await page.getByText('Files and locations',{exact:true}).click();await expect(page.locator('.storage-map')).toContainText('Original media');
  await page.screenshot({path:test.info().outputPath('storage-settings.png'),fullPage:true});
  const saved=await new Workspace(destination,await verifyAccess(await readAccess(destination),'',password)).read();expect(saved.book.projects).toHaveLength(0);expect(saved.book.notebooks).toHaveLength(0);
  expect(JSON.stringify(saved.book)).not.toContain(password);expect(JSON.stringify(saved.book)).not.toContain(destination);
  // Locking is an access setting, in Storage & access.
  await preferences(page,'Storage & access');await page.locator('main').getByRole('button',{name:'Lock workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  expect((await sessionRequest(page,'get',app.origin+'/api/notebook')).status()).toBe(401);
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
  await encryptedSample(sampleNotebook());const before=await new Workspace(root,workspaceVault).read();
  const destination=path.join(parent,'relocated'),preferencesFile=path.join(parent,'copy-preferences.json');
  await app.close();app=await startServer({root,port:0,preferencesFile,headless:true,deviceStore});await page.goto(app.url);
  await workspaceCommands(page);
  await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await expect(page.getByRole('dialog')).toContainText('The original stays in its current folder');
  await page.getByRole('button',{name:'Copy and use this folder',exact:true}).click();
  // Copying and verifying can take a while; the copy is named after its folder.
  await expect(page.getByRole('dialog')).not.toBeVisible({timeout:60000});
  await expect(page.locator('.workspace-name')).toHaveText('relocated');
  expect((await new Workspace(root,workspaceVault).read()).etag).toBe(before.etag);const copied=(await new Workspace(destination,workspaceVault).read()).book;expect(copied).toEqual({...before.book,title:'relocated',revision:before.book.revision+1,updatedAt:copied.updatedAt});expect(Date.parse(copied.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.book.updatedAt));
  expect(JSON.parse(await readFile(preferencesFile,'utf8')).workspace).toBe(destination);
  await workspaceCommands(page);await expect(page.locator('main')).toContainText(destination);
  await page.getByRole('button',{name:'Open existing workspace',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(root);
  await page.getByRole('button',{name:'Browse server folders',exact:true}).click();await page.getByRole('button',{name:'Use this folder',exact:true}).click();
  await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(root);
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('.workspace-name')).toHaveText('A closer look');
  await workspaceCommands(page);await expect(page.locator('main')).toContainText(root);
  await page.reload();await expect(page.locator('main').getByRole('heading',{name:'Workspace storage',exact:true})).toBeVisible();await expect(page.locator('main')).toContainText(root);
});

test('an unavailable remembered folder offers recovery instead of first-run creation',async({page})=>{
  // A real workspace exists elsewhere; the remembered folder is missing.
  await encryptedSample(sampleNotebook());
  await app.close();app=await startServer({root:path.join(parent,'missing-share'),port:0,expectedExisting:true,deviceStore});await page.goto(app.url);
  await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create workspace',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(root);await page.getByRole('dialog').getByRole('button',{name:'Open workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('A closer look');
});
import {chooseFont} from './font-helper.js';
import {publishPanel} from './website-site-menu-helper.js';
