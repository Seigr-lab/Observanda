import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {navigate} from './preferences-helper.js';
import {addSection,openPageSettings} from './composer-helper.js';

test('long-page authoring keeps save reachable, supports direct selection and saves from the canvas keyboard',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-ux-')),fixture=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const canvas=page.frameLocator('#website-draft-preview'),save=page.getByRole('button',{name:'Save website',exact:true});
 try{
  await page.setViewportSize({width:1440,height:900});await page.goto(app.url);await navigate(page,'Website editor');
  await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Long field report');
  await expect(page.getByRole('button',{name:'Remove page',exact:true})).toBeVisible();
  await addSection(page,'text');await page.getByLabel('Section heading',{exact:true}).fill('Observations');
  const text=canvas.getByRole('textbox',{name:'Section text',exact:true});await text.fill(Array.from({length:40},(_,i)=>'Observation '+i+': retain the evidence and its context.').join('\n\n'));
  await expect.poll(()=>page.locator('#website-draft-preview').evaluate(frame=>frame.offsetHeight)).toBeGreaterThan(2000);
  await text.press('Control+s');await expect(page.locator('#save-status')).toHaveText('Saved');
  const stored=(await new WebsiteSites(fixture.workspace).read(null)).book.pages.find(value=>value.title==='Long field report');expect(stored.sections[0].body).toContain('Observation 39');
  await openPageSettings(page);await canvas.getByRole('heading',{name:'Observations',exact:true}).click();await expect(page.getByLabel('Section heading',{exact:true})).toHaveValue('Observations');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));
   await expect.poll(()=>save.evaluate(button=>{const r=button.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.screenshot({path:test.info().outputPath('authoring-'+width+'.png')});
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight/2));
   await expect.poll(()=>save.evaluate(button=>{const r=button.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
   const heading=page.getByLabel('Section heading',{exact:true});await heading.focus();
   await expect.poll(()=>heading.evaluate(input=>{const r=input.getBoundingClientRect(),footer=document.querySelector('.section-save').getBoundingClientRect();return r.top>=0&&r.bottom<=footer.top;})).toBe(true);
   await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Edit text on page',exact:true})).toBeFocused();
   await expect.poll(()=>page.getByRole('button',{name:'Edit text on page',exact:true}).evaluate(button=>button.getBoundingClientRect().bottom<=document.querySelector('.section-save').getBoundingClientRect().top)).toBe(true);
  }
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
