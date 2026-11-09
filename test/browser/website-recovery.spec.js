import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {listWebsiteRecovery,readWebsiteRecovery} from '../../src/website-recovery.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {mediaFixtures} from '../media-fixtures.js';

test('a terminated website renderer offers its confirmed draft, restores selection, styles and original gallery pixels, then publishes',async({context,browser})=>{
 test.setTimeout(100000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-crash-')),folder=path.join(root,'Edition'),database=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture,reader;
 try{
  fixture=await encryptedFixture(root,createNotebook('Field observations'));await mkdir(folder);
  const store=new WebsiteFileStore(fixture.workspace),site=randomUUID();
  const base=await store.create({id:site,name:'Field guide',html:'<html><head><title>Field guide</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Field work</h1><p>Quadrat</p></main></body></html>',css:'p{color:navy}'});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  let page=await context.newPage(),canvas=()=>page.frameLocator('#website-files-canvas');
  const button=name=>page.getByRole('button',{name,exact:true});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  await button('Image gallery').click();await page.locator('[data-gallery-files]').setInputFiles('src/preview-assets/image.png');
  await expect(page.locator('[data-gallery-field=alt]')).toBeVisible();await page.locator('[data-gallery-field=alt]').fill('Sampling frame');
  await page.locator('[data-action=website-files-gallery-close]').click();
  const ink=canvas().locator('main > p');
  await ink.click();
  await page.locator('[data-visual-property="letter-spacing"]').fill('4');
  await button('Apply styles').click();await expect(ink).toHaveCSS('letter-spacing','4px');
  await ink.click();await page.keyboard.press('End');
  await page.keyboard.insertText(' eight');await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async()=>{
   const [row]=(await listWebsiteRecovery(store)).items;
   if(!row)return '';
   return (await readWebsiteRecovery(store,site,{id:row.id,path:row.documentKey,revision:row.revision})).html;
  },{timeout:12000}).toContain('Quadrat eight');
  await expect(page.getByText(/Recovery copy saved at/)).toBeVisible();
  const selected=await ink.evaluate(element=>element.ownerDocument.getSelection().toString());expect(selected).toBe('t');
  const url=page.url(),cdp=await context.newCDPSession(page),crashed=page.waitForEvent('crash');
  void cdp.send('Page.crash').catch(()=>{});await crashed;await page.close();
  page=await context.newPage();await page.goto(url);
  await expect(button('Recover draft')).toBeVisible();await expect(page.locator('[data-draft-id]')).toContainText(base.site.revision.slice(0,12));
  await expect(canvas().locator('main > p')).toHaveText('Quadrat');
  await button('Compare changes').click();await expect(page.getByRole('dialog')).toContainText('Quadrat eight');await button('Close comparison').click();
  await button('Recover draft').click();const recovered=canvas().locator('main > p');
  await expect(recovered).toHaveText('Quadrat eight');await expect(recovered).toHaveCSS('letter-spacing','4px');
  await expect.poll(()=>recovered.evaluate(element=>element.ownerDocument.getSelection().toString())).toBe(selected);
  await expect.poll(()=>canvas().getByAltText('Sampling frame').evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
  await button('Save website').click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  expect((await listWebsiteRecovery(store)).items).toHaveLength(0);
  await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await button('Write reviewed files').click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);
  await expect(reader.locator('main > p')).toHaveText('Quadrat eight');await expect(reader.locator('main > p')).toHaveCSS('letter-spacing','4px');
  await expect.poll(()=>reader.getByAltText('Sampling frame').evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

test('a recording and caption selected before Apply survive renderer loss with the entire authoring form',async({context})=>{
 test.setTimeout(90000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-recording-draft-')),database=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture;
 try{
  fixture=await encryptedFixture(root,createNotebook('Field methods'));
  const store=new WebsiteFileStore(fixture.workspace),site=randomUUID(),files=await mediaFixtures(root);
  await store.create({id:site,name:'Field media'});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  let page=await context.newPage();await page.goto(app.origin+'/?view=website#'+app.launchToken);
  await page.getByRole('button',{name:'Audio and video',exact:true}).click();
  await page.locator('[name=upload]').setInputFiles(files.audio.file);
  await page.locator('[name=vtt]').setInputFiles({name:'tone.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00.000 --> 00:00.350\nCalibration tone\n')});
  await page.locator('[name=language]').fill('en');await page.locator('[name=trackLabel]').fill('Spoken captions');
  await page.locator('[name=defaultTrack]').check();await page.locator('[name=title]').fill('Calibration signal');await page.locator('[name=transcript]').fill('Instrument warm-up');
  await expect(page.getByText(/Recovery copy saved at/)).toBeVisible({timeout:20000});
  expect((await store.open(site)).html).not.toContain('Instrument warm-up');expect([...(await store.export(site)).files.keys()].some(name=>name.endsWith('.wav'))).toBe(false);
  const url=page.url(),channel=await context.newCDPSession(page),crashed=page.waitForEvent('crash');void channel.send('Page.crash').catch(()=>{});await crashed;await page.close();
  page=await context.newPage();await page.goto(url);await page.getByRole('button',{name:'Recover draft',exact:true}).click();
  const form=page.locator('[data-recording-form]');await expect(form.locator('[name=transcript]')).toHaveValue('Instrument warm-up');
  await expect(form.locator('[name=title]')).toHaveValue('Calibration signal');await expect(form.locator('[name=defaultTrack]')).toBeChecked();
  await expect(form.getByText('Recovered file: tone.vtt')).toBeVisible();await form.locator('[type=submit]').click();
  const canvas=page.frameLocator('#website-files-canvas');
  await expect(canvas.getByText('Instrument warm-up')).toHaveCount(1,{timeout:20000});
  await expect(canvas.locator('audio track')).toHaveAttribute('label','Spoken captions');
  const actual=await store.export(site);expect([...actual.files.keys()].some(name=>name.endsWith('.wav'))).toBe(true);
  expect([...actual.files.keys()].some(name=>name.endsWith('.vtt'))).toBe(true);expect((await listWebsiteRecovery(store)).items).toHaveLength(0);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

test('unfinished source reopens as text and a subsequently withdrawn grant offers no draft contents',async({context})=>{
 test.setTimeout(90000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-grant-recovery-')),database=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture;
 try{
  fixture=await encryptedFixture(root,createNotebook('Methods'));
  const store=new WebsiteFileStore(fixture.workspace),site=randomUUID(),sourceId=createHash('sha256').update(randomUUID()).digest('hex');
  const pageBase=await store.create({id:site,name:'Methods'});
  await store.putSource({sourceId,title:'Field note',html:'<p>Withdrawn quadrat note</p>'},{token:await store.beginSourceUpdate({sourceId})});
  await store.insertSource(site,{sourceId,expectedRevision:pageBase.site.revision});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'prefs.json'),port:0});
  let page=await context.newPage();await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=name=>page.getByRole('button',{name,exact:true});
  async function interrupt(){
   const url=page.url(),channel=await context.newCDPSession(page),crash=page.waitForEvent('crash');void channel.send('Page.crash').catch(()=>{});await crash;await page.close();return url;
  }
  await button('HTML').click();const field=()=>page.locator('[data-website-file-code=html]'),text=(await field().inputValue())+'<img src="/unfinished">';
  await field().fill(text);await expect(page.getByText(/Recovery copy saved at/)).toBeVisible();
  let url=await interrupt();page=await context.newPage();await page.goto(url);await button('Recover draft').click();await expect(field()).toHaveValue(text);
  await button('Visual editor').click();await expect(field()).toBeVisible();await expect(page.locator('#website-files-canvas')).toHaveCount(0);
  url=await interrupt();await store.putSource({sourceId,title:'Withdrawn',visible:false},{token:await store.beginSourceUpdate({sourceId})});
  page=await context.newPage();await page.goto(url);await expect(button('Discard recovery copy')).toBeVisible();
  await expect(button('Recover draft')).toHaveCount(0);await expect(button('Compare changes')).toHaveCount(0);await expect(page.locator('[data-website-recovery]')).not.toContainText('Withdrawn quadrat note');
  await expect(page.frameLocator('#website-files-canvas').getByText('Withdrawn quadrat note')).toHaveCount(0);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});
