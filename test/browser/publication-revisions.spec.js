import {test,expect} from '@playwright/test';
import path from 'node:path';
import {historicalFixture} from '../publication-revisions-fixture.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';
import {revisionPageId} from '../../src/publication-revisions.js';
import {recordRevision} from '../../src/research.js';

test('review and include an exact old method from the app, then follow its public revision link',async({page})=>{
 test.setTimeout(90000);const cleanup=[],f=await historicalFixture({after:fn=>cleanup.push(fn)},{chain:true,title:'workspace'}),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(f.directory??path.dirname(f.workspace.root),'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Review website',exact:true}).click();
  const dialog=page.getByRole('dialog'),record=dialog.locator('[data-edition-record="'+f.run.id+'"]');
  await record.locator(':scope > summary').click();await record.getByRole('button',{name:'Review referenced revisions'}).click();
  const history=record.locator('[data-edition-history]');await history.locator(':scope > summary').click();await expect(history.getByLabel('Include this record',{exact:true})).not.toBeChecked();
  await history.getByText('Read retained text and fields',{exact:true}).click();await expect(history).toContainText('Exact older procedure');
  await history.getByLabel('Include this record',{exact:true}).check();await history.getByLabel('Withheld instructions',{exact:true}).uncheck();
  await record.getByLabel('Public availability statement (optional)').fill('Method available on request.');
  await history.getByRole('button',{name:'Review referenced revisions'}).click();
  const nested=record.locator('[data-edition-history]');await expect(nested).toContainText('Earlier result');await nested.locator(':scope > summary').click();await nested.getByLabel('Include this record',{exact:true}).check();
  await record.getByRole('button',{name:'Back to the referring record'}).click();
  await history.locator(':scope > summary').click();await expect(history.getByLabel('Include this record',{exact:true})).toBeChecked();await expect(history.getByLabel('Withheld instructions',{exact:true})).not.toBeChecked();
  await dialog.getByRole('button',{name:'Prepare selected edition'}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:20000});
  const id=revisionPageId(f.book.id,f.method.id,f.target.revision);await page.getByLabel('Preview page',{exact:true}).selectOption('entries/'+f.run.id+'.html');
  const frame=page.frameLocator('iframe');await expect(frame.locator('a[href="../entries/'+id+'.html"]')).toBeVisible();await frame.locator('a[href="../entries/'+id+'.html"]').click();
  await expect(frame.getByText('Exact older procedure',{exact:true})).toBeVisible();await expect(frame.getByText('HISTORICAL_PRIVATE_INSTRUCTIONS',{exact:true})).toHaveCount(0);await expect(frame.locator('.revision-edition')).toContainText(f.target.revision);
  const precursor=revisionPageId(f.book.id,f.linked.id,recordRevision(f.linked));await frame.locator('a[href="../entries/'+precursor+'.html"]').click();await expect(frame.getByText('Retained precursor result',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await app.close();for(const fn of cleanup)await fn();}
});
