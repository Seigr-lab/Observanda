import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {associateOriginal} from '../../src/evidence-associations.js';

test('reviewed corrections update current evidence and keep removed associations readable and restorable',async({page})=>{
 test.setTimeout(90000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-correction-ui-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),record=book.entries[2],bytes=Buffer.from('Synthetic exact disk bytes');
 const upload=await m.startImport({recordId:book.entries[0].id,name:'returned.img',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const source=await m.finishImport(upload.id),ref=await associateOriginal(m,{recordId:record.id,ref:source});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,headless:true,port:0}),errors=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id);await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Inspect',exact:true}).click();await dialog.getByRole('button',{name:'Correct evidence association',exact:true}).click();
  await dialog.getByLabel('Evidence title',{exact:true}).fill('Verified current return');await dialog.getByLabel('Relative source path',{exact:true}).fill('window-37/returned.img');await dialog.getByLabel('Source role',{exact:true}).selectOption('current-return');await dialog.getByLabel('Reason for correction',{exact:true}).fill('Restore the source folder and role.');
  await dialog.getByRole('button',{name:'Review correction',exact:true}).click();await expect(dialog).toContainText('window-37/returned.img');await dialog.getByRole('button',{name:'Apply reviewed correction',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Verified current return',exact:true})).toBeVisible();
  const revised=await m.current(ref.id);expect(revised.revision).not.toBe(ref.revision);
  await dialog.getByRole('button',{name:'Correct evidence association',exact:true}).click();await dialog.getByLabel('Correction',{exact:true}).selectOption('retire');await dialog.getByLabel('Reason for correction',{exact:true}).fill('This evidence belongs to the other acquisition.');await dialog.getByRole('button',{name:'Review correction',exact:true}).click();await dialog.getByRole('button',{name:'Apply reviewed correction',exact:true}).click();await expect(dialog).toContainText('This association was removed');expect(await m.current(ref.id)).toBeNull();
  const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Download original',exact:true}).click()]);const chunks=[];for await(const c of await download.createReadStream())chunks.push(c);expect(Buffer.concat(chunks)).toEqual(bytes);
  await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await expect(dialog.locator('.material-list')).toHaveCount(0);await dialog.getByRole('button',{name:'Evidence association history',exact:true}).click();await expect(dialog).toContainText('This evidence belongs to the other acquisition.');await dialog.getByRole('button',{name:'Inspect retained evidence',exact:true}).first().click();await dialog.getByRole('button',{name:'Correct evidence association',exact:true}).click();
  await expect(dialog.getByLabel('Correction',{exact:true})).toHaveValue('restore');await dialog.getByLabel('Reason for correction',{exact:true}).fill('Re-reviewed ownership and restored the association.');await dialog.getByRole('button',{name:'Review correction',exact:true}).click();await dialog.getByRole('button',{name:'Apply reviewed correction',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Verified current return',exact:true})).toBeVisible();expect((await m.current(ref.id)).revision).toBe(revised.revision);
  await dialog.getByRole('button',{name:'Correct evidence association',exact:true}).click();await dialog.getByLabel('Correction',{exact:true}).selectOption('reassign');await dialog.getByRole('button',{name:'Choose replacement record',exact:true}).click();await dialog.getByLabel('Find in this workspace',{exact:true}).fill(book.entries[1].title);await dialog.getByRole('button',{name:new RegExp(book.entries[1].title)}).click();await dialog.getByLabel('Reason for correction',{exact:true}).fill('Reviewed destination acquisition.');await dialog.getByRole('button',{name:'Review correction',exact:true}).click();await expect(dialog).toContainText(book.entries[1].title);await dialog.getByRole('button',{name:'Apply reviewed correction',exact:true}).click();await expect(dialog).toContainText('This association was removed');
  expect((await m.list({recordId:book.entries[1].id})).items.length).toBe(1);expect(await m.current(ref.id)).toBeNull();await m.verify();expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
