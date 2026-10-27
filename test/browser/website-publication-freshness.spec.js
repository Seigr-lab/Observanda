import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';

test('a prepared website remains downloadable after editing another website but rejects its own changed content',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-edition-ui-'));let fixture,app,other;
 try{
  const book=createNotebook('Publishing workspace');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Field journal','Course website'])ids.push((await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  const first=await sites.read(ids[0]);await sites.save(ids[0],{workspaceId:book.id,baseEtag:first.etag,websitePin:first.websitePin,metadata:{website:{...first.book.website,home:{...first.book.website.home,enabled:true,introduction:'Synthetic publication introduction'}}},projects:[],changes:[],removed:[],selection:first.site.selection});
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.url);await navigate(page,'Website editor');await page.goto(new URL('/#/websites/'+ids[0]+'/editor',app.url).href);
  await expect(page.locator('.website-site-context')).toContainText('Field journal');
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:15000});
  other=await page.context().newPage();await other.goto(new URL('/#/websites/'+ids[1]+'/editor',app.url).href);
  await expect(other.locator('.website-site-context')).toContainText('Course website');await task(other,'Site');await other.getByLabel('Website title',{exact:true}).fill('Changed course title');
  await other.getByRole('button',{name:'Save website',exact:true}).click();await expect(other.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();
  const stale=page.getByText('The workspace or publishing destination has changed since this edition was prepared.',{exact:false});await expect(stale).not.toBeVisible();
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download website ZIP',exact:true}).click();
  const bytes=await readFile(await (await downloading).path());expect(bytes.includes(Buffer.from('Field journal'))).toBe(true);expect(bytes.includes(Buffer.from('Changed course title'))).toBe(false);
  await other.goto(new URL('/#/websites/'+ids[0]+'/editor',app.url).href);await expect(other.locator('.website-site-context')).toContainText('Field journal');await task(other,'Site');
  await other.getByLabel('Website title',{exact:true}).fill('Changed journal title');await other.getByRole('button',{name:'Save website',exact:true}).click();await expect(other.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(stale).toBeVisible();await expect(page.getByRole('button',{name:'Download website ZIP',exact:true})).toBeDisabled();
 }finally{await other?.close();await page.close();await app?.close();if(fixture)clearVault(fixture.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));expect(path.basename(directory).startsWith('observanda-site-edition-ui-')).toBe(true);await rm(directory,{recursive:true,force:true});}
});
