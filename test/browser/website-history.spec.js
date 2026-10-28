import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {startServer} from '../../src/server.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {navigate} from './preferences-helper.js';
import {task,openPageSettings,chooseWebsitePage} from './composer-helper.js';

let app,root,book,fixture;
const savedBook=async()=>({...((await new WebsiteSites(fixture.workspace).read(null)).book),entries:(await fixture.workspace.read()).book.entries});
test.afterEach(async()=>{await app?.close();if(fixture)clearVault(fixture.vault);await rm(root,{recursive:true,force:true});});
async function open(page,configure){
 root=await mkdtemp(path.join(os.tmpdir(),'observanda-editor-state-'));book=upgradeNotebook(sampleNotebook());book.website.home.sections=[];configure(book);
 fixture=await encryptedFixture(root,book);app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
 await page.goto(app.url);await navigate(page,'Website editor');await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','home');
}
test('large website edits keep unrelated pages out of requests while undo, redo and save retain the draft',async({page},testInfo)=>{
 test.setTimeout(120000);
 await open(page,book=>{book.pages=Array.from({length:12},(_,i)=>({id:randomUUID(),title:'Long page '+i,body:('Authored page '+i+' ').padEnd(50000,'.'),share:false,sections:[]}));});
 const requests=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/'))requests.push(request.postData()??'');});
 await task(page,'Site');
 for(let i=0;i<10;i++){
  await page.getByLabel('Website title',{exact:true}).fill('Title '+i);
  await page.getByLabel('Website description',{exact:true}).fill('Description '+i);
 }
 expect(requests.every(body=>!body.includes('Authored page'))).toBe(true);
 expect(Math.max(...requests.map(body=>body.length),0)).toBeLessThan(32000);
 await expect(page.frameLocator('#website-draft-preview').locator('.site-name')).toHaveText('Title 9');
 await page.screenshot({path:testInfo.outputPath('bounded-history.png')});
 await expect(page.getByLabel('Website title',{exact:true})).toHaveValue('Title 9');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByLabel('Website description',{exact:true})).toHaveValue('Description 8');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByLabel('Website title',{exact:true})).toHaveValue('Title 8');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();
 await expect(page.getByLabel('Website description',{exact:true})).toHaveValue('Description 9');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 const saved=(await savedBook());expect(saved.website.title).toBe('Title 9');expect(saved.website.description).toBe('Description 9');expect(saved.pages).toEqual(book.pages);expect(saved.entries).toEqual(book.entries);
 await expect(page.locator('#website-history-status')).toBeHidden();
 await page.reload();await task(page,'Site');await expect(page.getByLabel('Website title',{exact:true})).toHaveValue('Title 9');
});

test('navigation remembers only recent page contexts without losing saved designs or returning to a wrong page',async({page})=>{
 test.setTimeout(120000);
 await open(page,book=>{const seed=book.entries[0];book.entries=Array.from({length:30},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Page '+i,relations:[],attachments:[],figures:[]}));});
 const path=id=>'entries/'+id+'.html';
 await chooseWebsitePage(page,path(book.entries[0].id));
 await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Display heading',{exact:true}).fill('Saved first design');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 for(const record of book.entries.slice(1)){
  await chooseWebsitePage(page,path(record.id));
  await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','entry:'+record.id);
 }
 const key='observanda.editor.'+book.id+'.workspace';
 const remembered=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
 expect(Object.keys(remembered.documents)).toHaveLength(24);expect(remembered.documents[path(book.entries[0].id)]).toBeUndefined();
 await navigate(page,'Dashboard');await navigate(page,'Website editor');
 await expect(page.getByLabel('Page',{exact:true})).toHaveValue(path(book.entries.at(-1).id));
 await page.reload();await expect(page.getByLabel('Page',{exact:true})).toHaveValue(path(book.entries.at(-1).id));
 await chooseWebsitePage(page,path(book.entries[0].id));
 await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Saved first design',exact:true})).toBeVisible();
 expect((await savedBook()).entries).toEqual(book.entries);
});
