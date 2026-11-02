import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {contentStream} from '../../src/file-content.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('captions, descriptive links and a bibliography survive native file save, reopen and standalone publication',async({page})=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'scientific-site-'));
 try{
  await mkdir(path.join(dir,'.observanda'));const vault=new Workspace(dir,{id:randomUUID(),key:randomBytes(32)});
  vault.catalogue=vault.storageKind=()=>{throw Error('Research storage unavailable');};
  const store=new WebsiteFileStore(vault),site=await store.create({name:'Field study',html:'<!doctype html><html><head><title>Counts</title></head><body><main><h1>Counts</h1><p id="writing">Results. </p><div data-image-gallery><figure><figcaption>Pond photograph</figcaption></figure></div><table><caption>Baseline</caption><tbody><tr><td>22</td></tr></tbody></table><div id="ambiguous"></div><figure id="ambiguous"><figcaption>Collision</figcaption></figure></main></body></html>'});
  const id=site.site.id,sourceId='1'.repeat(64);
  await store.putSource({sourceId,title:'Released field sample',html:'<section data-observanda-part="body"><figure><figcaption>Released sample figure</figcaption></figure><p>Released sample prose</p></section>'},{token:await store.beginSourceUpdate({sourceId})});
  const placed=await store.insertSource(id,{sourceId,expectedRevision:site.site.revision});
  await page.exposeFunction('filesAPI',async(route,data)=>{
   if(route.endsWith('/session'))return {workspaceId:vault.id,title:'Study',sites:[placed.site]};
   if(route.endsWith('/open'))return store.open(id,{path:data.path});
   if(route.endsWith('/save'))return store.save(id,data);
   if(route.endsWith('/version'))return {revision:await store.siteVersion(id)};
   throw Error('Unexpected request '+route);
  });
  await mountFilesEditor(page);const canvas=page.frameLocator('#website-files-canvas'),panel=page.locator('.website-science-inspector');
  await expect(canvas.locator('h1')).toHaveText('Counts');await panel.locator('summary').click();
  const task=panel.getByLabel('Task',{exact:true}),target=panel.getByLabel('Page target'),status=panel.getByRole('status');
  await expect(canvas.getByText('Released sample figure',{exact:true})).toBeVisible();
  await expect(target.getByRole('option',{name:/Released sample/})).toHaveCount(0);
  const cap=panel.getByLabel('Caption text'),setCaption=panel.getByRole('button',{name:'Save caption'});
  await target.selectOption({label:'Figure · Collision'});await cap.fill('Invalid duplicate');await setCaption.click();await expect(status).toContainText('shares its HTML ID');
  await target.selectOption({label:'Figure · Pond photograph'});await cap.fill('Pond sampling quadrat');await setCaption.click();
  await target.selectOption({label:'Table · Baseline'});await cap.fill('Observed insects by plot');await setCaption.click();
  await task.selectOption('scienceReference');await panel.getByLabel('Author or authors').fill('Field group');await panel.getByLabel('Year or date').fill('2025');
  await panel.getByLabel('Work title').fill('Sampling methods');const url=panel.getByLabel('DOI or HTTPS URL (optional)');
  await url.fill('javascript:alert(1)');await panel.getByRole('button',{name:'Save reference'}).click();await expect(status).toContainText('HTTPS');await expect(canvas.locator('cite')).toHaveCount(0);
  await url.fill('10.1234/field.25');await panel.getByRole('button',{name:'Save reference'}).click();
  const reference=canvas.locator('[data-website-reference]'),refId=await reference.getAttribute('id'),tableId=await canvas.locator('table').getAttribute('id');
  await reference.evaluate(n=>{const note=n.ownerDocument.createElement('em');note.textContent='Verified edition';n.append(note);n.dispatchEvent(new Event('input',{bubbles:true}));});
  await panel.getByLabel('Work title').fill('Field sampling methods');await panel.getByRole('button',{name:'Save reference'}).click();
  await expect(reference).toHaveAttribute('id',refId);await expect(reference.locator('em')).toHaveText('Verified edition');
  async function appendLink(choice,text){
   await canvas.locator('#writing').click();await page.keyboard.press('End');await task.selectOption('scienceLink');
   await target.selectOption({label:choice});await panel.getByLabel('Link text',{exact:true}).fill(text);
   await panel.getByRole('button',{name:'Insert cross-reference'}).click();await expect(canvas.getByRole('link',{name:text,exact:true})).toBeVisible();
  }
  await appendLink('Table · Observed insects by plot','Compare the plot counts');
  await appendLink('Bibliographic reference · Field sampling methods','Field group (2025)');
  await task.selectOption('scienceReference');await target.selectOption({label:'Bibliographic reference · Field sampling methods'});
  await panel.getByRole('button',{name:'Remove reference'}).click();await expect(status).toContainText('Remove its links');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.reload();await expect(canvas.locator('#writing a')).toHaveCount(2);await expect(canvas.locator('figcaption').first()).toHaveText('Pond sampling quadrat');
  await store.putSource({sourceId,title:'Withdrawn',visible:false},{token:await store.beginSourceUpdate({sourceId})});
  const fresh=await store.open(id),publication=await WebsiteFilesCandidate.open(store,id,fresh.site.revision);await publication.verify();
  const chunks=[];for await(const bytes of contentStream(publication.files.get('index.html')))chunks.push(bytes);
  const html=Buffer.concat(chunks).toString();expect(html).not.toMatch(/data-observanda-editor|contenteditable|Released sample/i);
  await page.route('https://field.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://field.test/');
  await expect(page.locator('table > caption')).toHaveText('Observed insects by plot');await page.getByRole('link',{name:'Compare the plot counts'}).click();await expect(page).toHaveURL('https://field.test/#'+tableId);
  await page.getByRole('link',{name:'Field group (2025)'}).click();await expect(page).toHaveURL('https://field.test/#'+refId);
  await expect(page.locator('cite')).toHaveText('Field sampling methods');await expect(page.getByRole('link',{name:'https://doi.org/10.1234/field.25'})).toHaveAttribute('href','https://doi.org/10.1234/field.25');
 }finally{await closeIdleMutationFiles();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
