import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createNotebook} from '../../src/model.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('configure reusable title fields, use visual main styling and publish a customized linked card with research offline',async({page,browser})=>{
 test.setTimeout(90000);page.setDefaultTimeout(8000);
 const root=await mkdtemp(path.join(os.tmpdir(),'component-studio-')),folder=path.join(root,'public'),db=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,reader;
 try{
  await mkdir(folder);fixture=await encryptedFixture(root,createNotebook('Materials'));
  const id=randomUUID(),store=new WebsiteFileStore(fixture.workspace);
  const start=await store.importFiles(id,{name:'Specimens',files:new Map([['style.css','article{padding:16px}'],['index.html','<html><head><title>Lab</title><link rel="stylesheet" href="style.css"></head><body><main><article><h2>Sample</h2><p>Instrument data</p></article></main></body></html>']])});
  const sourceId=websiteSourceId({workspaceId:fixture.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
  const token=await store.beginSourceUpdate({sourceId}),entry=await store.putSource({sourceId,visible:true,title:'Spectroscopy',html:'<p data-observanda-part="text">Peak at 518 nm</p>'},{token});
  await store.insertSource(id,{expectedRevision:start.site.revision,sourceId,sourceRevision:entry.revision,position:'end'});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'prefs.json'),port:0});
  const b=(host,name)=>host.getByRole('button',{name,exact:true}),canvas=page.frameLocator('#website-files-canvas'),library=page.locator('[data-website-components]');
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await expect(canvas.locator('article')).toBeVisible();
  await b(page,'Reusable library').click();await canvas.locator('article').click({position:{x:5,y:5}});
  await library.getByLabel('Component name',{exact:true}).fill('Research card');await b(library,'Create from selected block').click();await b(library,'Edit main component').click();
  const d=page.getByRole('dialog',{name:'Edit main component'}),main=d.frameLocator('iframe');
  await d.getByText('Editable fields',{exact:true}).click();
  await d.getByRole('combobox',{name:'Page element',exact:true}).selectOption({label:'h2 · Sample'});
  await d.getByLabel('Field name',{exact:true}).fill('Specimen name');await b(d,'Save field').click();
  await b(d,'Add a linked entry area').click();
  await main.locator('article').click({position:{x:3,y:3}});
  await d.locator('[data-visual-property="font-size"]').fill('24');await b(d,'Apply styles').click();
  await b(d,'Review component changes').click();await expect(d).toContainText('Placements 1 · Pages 1 · Local values to clear 0');
  await d.locator('[data-main-apply]').click();await expect(d).toHaveCount(0);await expect(canvas.locator('article')).toHaveCSS('font-size','24px');
  await canvas.locator('article').click({position:{x:4,y:4}});await b(library,'Customize instance').click();
  const edit=page.getByRole('dialog',{name:'Customize instance'});await edit.getByLabel('Use a value for this instance').check();
  await edit.getByLabel('Text',{exact:true}).fill('Excavation 12');await b(edit,'Save instance').click();await expect(canvas.getByRole('heading',{name:'Excavation 12'})).toBeVisible();
  await canvas.getByText('Peak at 518 nm',{exact:true}).click();
  await b(library,'Frame the selected entry').click();
  await expect(canvas.locator('article [data-observanda-source]')).toContainText('Peak at 518 nm');
  await b(page,'Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await b(page,'Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await b(page,'Write reviewed files').click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);
  await expect(reader.getByRole('heading',{name:'Excavation 12'})).toBeVisible();await expect(reader.locator('article').first()).toHaveCSS('font-size','24px');
  await expect(reader.locator('article').last()).toContainText('Peak at 518 nm');
 }finally{
  if(db===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=db;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:10});}
 }
});
