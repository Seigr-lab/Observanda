import {test,expect} from '@playwright/test';
import path from 'node:path';
import {historicalFixture} from '../publication-revisions-fixture.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';

test('save two legacy chapter fragments through the app and follow each individual destination',async({page})=>{
 const cleanup=[],f=await historicalFixture({after:fn=>cleanup.push(fn)}),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(path.dirname(f.workspace.root),'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Legacy website links'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Add legacy page',exact:true}).click();
  await dialog.getByLabel('Old page path',{exact:true}).fill('archive/old-chapter.html');await dialog.getByLabel('Public page title',{exact:true}).fill('Earlier investigations');
  for(const [i,record] of [f.run,f.method].entries()){
   if(i)await dialog.getByRole('button',{name:'Add fragment mapping'}).click();const row=dialog.locator('[data-legacy-anchor]').nth(i);
   await row.getByLabel('Old fragment',{exact:false}).fill('investigation-0');await row.getByLabel('Public link label',{exact:true}).fill('Investigation '+i);
   await row.getByRole('button',{name:'Choose destination record'}).click();await row.getByRole('searchbox').fill(record.title);await row.getByRole('button',{name:new RegExp(record.title)}).click();
  }
  await dialog.getByRole('button',{name:'Save legacy links'}).click();
  await expect(dialog.getByRole('alert')).toContainText('archive/old-chapter.html#investigation-0');await expect(dialog).toContainText('More than one mapping uses this fragment');
  await expect(dialog.locator('[data-legacy-anchor]').nth(1).getByLabel('Old fragment',{exact:false})).toBeFocused();
  await dialog.locator('[data-legacy-anchor]').nth(1).getByLabel('Old fragment',{exact:false}).fill('investigation-1');await dialog.getByRole('button',{name:'Save legacy links'}).click();
  await page.getByRole('button',{name:'Review website',exact:true}).click();await dialog.getByRole('button',{name:'Prepare selected edition'}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:20000});
  await page.getByLabel('Preview page',{exact:true}).selectOption('archive/old-chapter.html');const frame=page.frameLocator('iframe');await expect(frame.locator('#investigation-0 a')).toHaveAttribute('href','../entries/'+f.run.id+'.html');await expect(frame.locator('#investigation-1 a')).toHaveAttribute('href','../entries/'+f.method.id+'.html');await frame.locator('#investigation-1 a').click();await expect(frame.getByText('New procedure',{exact:true})).toBeVisible();expect(errors).toEqual([]);
 }finally{await app.close();for(const fn of cleanup)await fn();}
});
