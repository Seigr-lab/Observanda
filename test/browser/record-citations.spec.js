import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {journeyBook} from '../book-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

test('a structured citation records an uncertain date, an archive and checked identifiers',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-citations-')),f=journeyBook();f.concept.body='Sources for this record.';
 const storage=await encryptedFixture(directory,f.book),app=await startServer({root:storage.workspace.root,deviceStore:storage.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,f.concept.id);
  await page.getByRole('button',{name:'Edit summary / context',exact:true}).click();
  const writing=page.locator('dialog.record-writing[open]'),panel=page.getByRole('dialog',{name:'Book content',exact:true});
  await writing.getByRole('textbox',{name:'Writing',exact:true}).click();await page.keyboard.press('Control+End');
  await writing.getByRole('button',{name:'Book content',exact:true}).click();
  await panel.getByLabel('Content kind').selectOption('book_citation');
  await panel.getByLabel('Title / caption',{exact:true}).fill('Parish survey');
  await panel.getByLabel('Authors',{exact:true}).fill('Doe, Jane\nRoe, Richard');
  await panel.getByRole('combobox',{name:'Known precision',exact:true}).selectOption('year');
  await panel.getByLabel('Date (YYYY, YYYY-MM or YYYY-MM-DD)',{exact:true}).fill('1911');await panel.getByLabel('Estimated',{exact:true}).check();
  await panel.getByLabel('Archive, collection or call number',{exact:true}).fill('County archive, box 4');
  await panel.getByLabel('Identifiers',{exact:true}).fill('doi: 10.1000/182\nisbn: 978-0-306-40615-8');
  await panel.getByRole('button',{name:'Apply content',exact:true}).click();
  await expect(panel.locator('[data-book-error]')).toHaveText('This identifier is not valid: isbn: 978-0-306-40615-8');
  await panel.getByLabel('Identifiers',{exact:true}).fill('doi: https://doi.org/10.1000/182\nisbn: 978-0-306-40615-7');
  await panel.getByRole('button',{name:'Apply content',exact:true}).click();await expect(panel).toHaveCount(0);
  await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).toHaveCount(0);
  await page.getByRole('button',{name:'Read record',exact:true}).click();
  const citation=page.locator('.record-reader .book-citation').filter({hasText:'Parish survey'});
  await expect(citation).toContainText('Doe, Jane; Roe, Richard');await expect(citation).toContainText('County archive, box 4');await expect(citation).toContainText('ISBN 9780306406157');
  await expect(citation.getByRole('link',{name:'DOI 10.1000/182',exact:true})).toHaveAttribute('href','https://doi.org/10.1000/182');
  const saved=(await storage.workspace.read()).book.entries.find(item=>item.id===f.concept.id),node=JSON.stringify(saved.body).match(/"type":"book_citation"/);expect(node).toBeTruthy();
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(storage.vault);await rm(directory,{recursive:true,force:true});}
});
