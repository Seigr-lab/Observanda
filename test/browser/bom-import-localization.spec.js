import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {testServer} from '../device-fixture.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {clearVault} from '../../src/encryption.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

const catalogue=(locale,name)=>readFile(new URL('../../src/web/locales/'+locale+'/'+name+'.json',import.meta.url),'utf8').then(JSON.parse);
test('BOM import localizes server and preview diagnostics while retaining source content',async({page})=>{
 test.setTimeout(150000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bom-language-')),book=upgradeNotebook({...sampleNotebook(),title:'workspace'}),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace);
 let app;const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
 try{
  for(const[name,source]of [['Malformed.csv','Value,Qty\nA'],['Authored.csv','Description,Needed,,Custom <column>\nAuthored <value>,2,empty,preserved']]){
   const bytes=Buffer.from(source),upload=await materials.startImport({recordId:book.entries[0].id,name,size:bytes.length,provenance:'Synthetic localization test',derivesFrom:[]});await materials.appendImport(upload.id,0,[bytes]);await materials.finishImport(upload.id);
  }
  const settings=defaultDashboard();settings.enabledModules=['resources'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  const original=(await f.workspace.read()).book;await page.goto(app.url);
  const main=page.locator('main'),dialog=page.locator('#dialog');
  for(const locale of ['ca','es','nb','nn','en']){
   const messages=await catalogue(locale,'bomImport'),editors=await catalogue(locale,'moduleEditors'),parser=await catalogue(locale,'figureDiagnostics');
   await page.evaluate(()=>location.hash='#/preferences/help');await page.locator('[data-language-choice]').selectOption(locale);await expect(page.locator('.preferences-heading')).toHaveAttribute('lang',locale);
   await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
   await expect(main.locator('[data-create-type="bom"]')).toBeAttached();const evidence=main.locator('[data-disclosure="record-evidence"], [data-disclosure="draft-evidence"]');if(await evidence.count()&&await evidence.getAttribute('open')===null)await evidence.locator(':scope > summary').click();
   await main.locator('[data-create-type="bom"]').click();await main.locator('[data-command="bom-import"]').click();
   const source=dialog.locator('#bom-source-select');await expect(source).toBeEnabled();
   await source.selectOption(await source.locator('option').filter({hasText:'Malformed.csv'}).getAttribute('value'));
   const response=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/modules/bom-source'&&!value.ok());await dialog.locator('[data-bom-load]').click();
   expect((await (await response).json()).details[0].diagnostic.key).toBe('tableWidth');
   await expect(dialog.locator('[data-bom-message]')).toContainText(parser.tableWidth.replace('{line}','2').replace('{found}','1').replace('{expected}','2'));
   await source.selectOption(await source.locator('option').filter({hasText:'Authored.csv'}).getAttribute('value'));await dialog.locator('[data-bom-load]').click();
   await expect(dialog.locator('[data-bom-map="value"] option[value="2"]')).toHaveText(messages.column.replace('{number}','3'));
   await expect(dialog.locator('[data-bom-map="value"] option[value="3"]')).toHaveText('Custom <column>');
   await dialog.locator('[data-bom-preview]').click();await expect(dialog.locator('[data-bom-message]')).toHaveText(messages.mapping);
   await expect(dialog.locator('[data-bom-apply]')).toBeDisabled();await expect(main.locator('.bom-line')).toHaveCount(0);
   await dialog.locator('[data-bom-map="quantity"]').selectOption('1');await dialog.locator('[data-bom-preview]').click();
   await expect(dialog.getByRole('region',{name:editors.importedComponents})).toContainText('Authored <value>');expect(await dialog.locator('value,column').count()).toBe(0);
   await expect(dialog.locator('[data-bom-review]')).toContainText('Custom <column>');
   await dialog.locator('[data-action="close-dialog"]').click();await main.locator('[data-command="discard"]').click();
  }
  expect(errors).toEqual([]);expect((await f.workspace.read()).book).toEqual(original);
 }finally{await app?.close();clearVault(f.vault);if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-bom-language-'))throw Error('Invalid test cleanup path');await rm(directory,{recursive:true,force:true});}
});
