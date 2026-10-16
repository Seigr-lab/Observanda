import {WorkspaceFonts} from '../../src/workspace-fonts.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {editorTab,task,chooseWebsitePage,openPageSettings} from './composer-helper.js';
import {navigate} from './preferences-helper.js';

test('project website editing preview and export retain their owner through reload and workspace navigation',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-publication-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[],errors=[],requests=[];let app,db;
 try{
  const rootBook=sampleNotebook();rootBook.projects.push(...Array.from({length:30},(_,i)=>({...rootBook.projects[0],id:randomUUID(),title:'Catalogue project '+String(i).padStart(2,'0'),share:false})));const f=await encryptedFixture(path.join(directory,'Workspace'),rootBook);vaults.push(f.vault);
  const book=sampleNotebook();book.projects[0].title='Independent project';book.entries[0].title='Independent experiment';const id=book.projects[0].id,access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);
  book.title=book.projects[0].title='Independent project';
  const storage=await initializeProjectLocation(path.join(directory,'Independent project'),id,book,access,vault),registry=new ProjectRegistry(f.workspace,rootBook.id);await registry.attach(storage,{expected:(await registry.read()).revision});
  const font=await new WorkspaceFonts(storage).import(await readFile('src/fonts/dm-sans.ttf'));
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().includes('/api/'))requests.push({status:response.status(),route:new URL(response.url()).pathname});});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await page.goto(app.origin+'/#/owners/'+id+'/projects/'+id);await expect(page.locator('#main h1')).toHaveText('Independent project');expect(await page.evaluate(async id=>(await document.fonts.load('16px \"Observanda '+id+'\"')).some(font=>font.status==='loaded'),font.id)).toBe(true);
  db=await f.workspace.openCatalogue();await db.run('BEGIN');await db.lock();
  await page.getByRole('button',{name:'Project websites',exact:true}).click();await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Experiment journal');await page.getByRole('button',{name:'Create website',exact:true}).click();
  await expect(page.locator('.website-site-context')).toContainText('Experiment journal');expect(page.url()).toContain('/owners/'+id+'/websites/');
  await editorTab(page,'Media');await page.getByLabel('Upload website media',{exact:true}).setInputFiles('src/preview-assets/image.png');await expect(page.locator('.website-media-library article')).toHaveCount(1,{timeout:30000});const media=page.locator('.website-media-library article img');await expect(media).toHaveAttribute('src',new RegExp('/api/projects/'+id+'/media/'));await expect.poll(()=>media.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Independent experiment journal');
  await task(page,'Content');await expect(page.locator('[data-publish-entry="'+book.entries[0].id+'"]').first()).not.toBeChecked();await page.locator('[data-publish-entry="'+book.entries[0].id+'"]').check();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await chooseWebsitePage(page,'entries/'+book.entries[0].id+'.html');await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Display heading',{exact:true}).fill('Selected project observation');
  await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Selected project observation',exact:true})).toBeVisible();await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const websiteUrl=page.url();await page.reload();await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Selected project observation',exact:true})).toBeVisible();
  await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();await page.getByLabel('GitHub owner / organization',{exact:true}).fill('Example');await page.getByLabel('Repository name',{exact:true}).fill('project-experiments');await page.getByRole('button',{name:'Save destination',exact:true}).click();await expect(page.locator('#destination-status')).toHaveText('Destination saved on this device.');
  await page.goto(websiteUrl);await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.locator('#full-public-preview')).toBeVisible();
  const preview=await page.locator('#full-public-preview').getAttribute('href');expect(preview).toContain('/api/projects/'+id+'/publication-preview/');
  const viewed=await page.context().request.get(app.origin+preview);expect(viewed.status()).toBe(200);expect(await viewed.text()).toContain('Selected project observation');
  await page.locator('#review-confirm').check();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download website ZIP',exact:true}).click();expect((await download).suggestedFilename()).toBe('observanda-site.zip');
  await db.close();db=null;await navigate(page,'Website editor');await expect(page.locator('.website-site-context')).toContainText('Workspace website');expect(page.url()).not.toContain('/owners/');
  await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();
  const journal=page.locator('[data-website-directory] section').filter({has:page.getByRole('heading',{name:'Experiment journal',exact:true})});await expect(journal).toBeVisible();await journal.getByRole('button',{name:'Website editor',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Experiment journal');expect(page.url()).toContain('/owners/'+id+'/websites/');
  await navigate(page,'Website editor');await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Second independent site');await page.getByRole('button',{name:'More choices',exact:true}).click();await expect(page.getByLabel('Project',{exact:true}).locator('option[value="'+id+'"]')).toHaveCount(1);await page.getByLabel('Project',{exact:true}).selectOption(id);await page.getByRole('button',{name:'Create website',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Second independent site');expect(page.url()).toContain('/owners/'+id+'/websites/');
  await page.goto(websiteUrl);await expect(page.locator('.website-site-context')).toContainText('Experiment journal');
  expect((await f.workspace.outline()).metadata.websites??[]).toEqual([]);expect((await storage.outline()).metadata.websites[0].name).toBe('Experiment journal');
  expect(requests.filter(r=>r.status>=400)).toEqual([]);expect(errors).toEqual([]);
 }catch(error){
  await test.info().attach('publication-requests',{body:JSON.stringify({errors,requests},null,2),contentType:'application/json'});
  await test.info().attach('publication-before-cleanup',{body:await page.screenshot(),contentType:'image/png'});throw error;
 }finally{await db?.close();await app?.close();await owner.close();detach();for(const vault of vaults)clearVault(vault);if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-project-publication-ui-'))throw Error('Invalid test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
