import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {task,sectionTools} from './composer-helper.js';
import {enhancePublicPopups} from '../../src/web/public-popups.js';
import {popupMarkup,copyTextMarkup} from '../../src/publication-popups.js';
const canvas=page=>page.frameLocator('#website-draft-preview');

test('author a support popup with links and exact copy addresses; visitors use keyboard, clipboard fallback and no-script content',async({page,browser},info)=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-popup-')),f=await encryptedFixture(root,createNotebook('Studio',''));
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const addresses=[['Ethereum example','Ethereum network','0xAbCd0123456789EfAbCd0123456789EfAbCd0123'],['Polygon example','Polygon network','0xAbCd0123456789EfAbCd0123456789EfAbCd0123'],['Bitcoin example','Bitcoin network','bc1qExampleAddressWithCaseAnd0123456789']];
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Support page');const target=await page.getByLabel('Page',{exact:true}).inputValue();await task(page,'Page');
  await page.locator('[data-palette-kind=popup]').click();await canvas(page).locator('.section-popup>.canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('Support our work');await page.getByLabel('Popup button label',{exact:true}).fill('Support');await page.getByLabel('Popup width (px)',{exact:true}).fill('700');await task(page,'Page');
  await page.locator('[data-palette-kind=text]').click();await canvas(page).locator('.section-popup .section-text>.canvas-section-edit').click();await canvas(page).getByRole('textbox',{name:'Section text',exact:true}).fill('Choose a support link or copy an address for use in your own wallet.');await task(page,'Page');
  for(const[name,href]of [['GitHub Sponsors','https://github.com/sponsors/example'],['PayPal','https://example.org/paypal']]){
   const count=await canvas(page).locator('.section-popup .section-link').count();await page.locator('[data-palette-kind=link]').click();await expect(canvas(page).locator('.section-popup .section-link')).toHaveCount(count+1);await canvas(page).locator('.section-popup .section-link>.canvas-section-edit').last().click();await page.getByLabel('Link label',{exact:true}).fill(name);await page.getByLabel('Link destination',{exact:true}).fill(href);await task(page,'Page');
  }
  for(const [index,[name,network,value]]of addresses.entries()){
   await page.locator('[data-palette-kind=copy-text]').click();await expect(canvas(page).locator('.section-copy-text')).toHaveCount(index+1);await canvas(page).locator('.section-copy-text>.canvas-section-edit').last().click();await page.getByLabel('Section heading',{exact:true}).fill(name);await page.getByLabel('Description or network',{exact:true}).fill(network);await page.getByLabel('Text to copy',{exact:true}).fill(value);await page.getByLabel('Copy button label',{exact:true}).fill('Copy address');await sectionTools(page,'Layout');await page.getByLabel('Surface',{exact:true}).selectOption('card');await task(page,'Page');
  }
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas(page).locator('.section-popup .section-copy-text')).toHaveCount(3);await canvas(page).locator('.section-popup>.canvas-section-edit').click();await expect(page.getByLabel('Popup width (px)',{exact:true})).toHaveValue('700');
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await page.getByLabel('Preview page',{exact:true}).selectOption(target);
  const href=await page.locator('#full-public-preview').getAttribute('href'),url=new URL(href,app.origin).href,visitor=await page.context().newPage();visitor.on('pageerror',error=>errors.push(error.message));
  try{
   await visitor.addInitScript(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.denyCopy)throw Error('Permission denied');window.copied.push(value);}},configurable:true});});
   await visitor.goto(url);const trigger=visitor.locator('[data-public-popup]>summary');await expect(trigger).toHaveAttribute('aria-haspopup','dialog');await trigger.focus();await visitor.keyboard.press('Enter');const dialog=visitor.getByRole('dialog',{name:'Support our work',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Close popup',exact:true})).toBeFocused();await expect(dialog.getByRole('button',{name:'Close popup',exact:true})).toHaveText('×');
   await expect(dialog.getByRole('link',{name:'GitHub Sponsors',exact:false})).toHaveAttribute('href','https://github.com/sponsors/example');await expect(dialog.getByRole('link',{name:'PayPal',exact:false})).toHaveAttribute('href','https://example.org/paypal');
   for(const [index,[name,,value]]of addresses.entries()){
    const copy=dialog.locator('.public-copy').nth(index);await expect(copy.getByRole('textbox',{name,exact:true})).toHaveValue(value);await copy.getByRole('button',{name:'Copy address',exact:true}).click();await expect(copy.getByRole('status')).toHaveText('Copied to clipboard.');
   }
   expect(await visitor.evaluate(()=>window.copied)).toEqual(addresses.map(([, ,value])=>value));
   await visitor.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Close popup',exact:true})).toBeFocused();await visitor.screenshot({path:info.outputPath('support-popup-desktop.png')});await visitor.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
   await trigger.click();await visitor.evaluate(()=>{window.denyCopy=true;});const copy=dialog.locator('.public-copy').first();await copy.getByRole('button',{name:'Copy address',exact:true}).click();await expect(copy.getByRole('status')).toHaveText('Automatic copying is unavailable. Select and copy the text above.');const field=copy.locator('textarea');await expect(field).toBeFocused();expect(await field.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([0,addresses[0][2].length]);
   await visitor.setViewportSize({width:390,height:844});await visitor.evaluate(()=>document.documentElement.style.fontSize='24px');await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await visitor.screenshot({path:info.outputPath('support-popup-mobile.png')});await dialog.getByRole('button',{name:'Close popup',exact:true}).click();await expect(trigger).toBeFocused();
   // Direct anchors into popup content expose the target, rather than leaving a hidden destination.
   const anchor=await visitor.locator('.section-copy-text').last().getAttribute('id');await visitor.goto(url+'#'+anchor);await expect(dialog).toBeVisible();await expect(dialog.getByRole('textbox',{name:'Bitcoin example',exact:true})).toBeVisible();await visitor.keyboard.press('Escape');
   expect(await visitor.locator('[id]').evaluateAll(nodes=>new Set(nodes.map(node=>node.id)).size===nodes.length)).toBe(true);
  }finally{await visitor.close();}
  const fallback=await browser.newContext({javaScriptEnabled:false});await fallback.addCookies(await page.context().cookies());const reader=await fallback.newPage();
  try{await reader.goto(url);await reader.locator('[data-public-popup]>summary').click();await expect(reader.getByRole('textbox',{name:'Ethereum example',exact:true})).toHaveValue(addresses[0][2]);await expect(reader.getByRole('link',{name:'PayPal',exact:false})).toBeVisible();await expect(reader.locator('.public-copy button').first()).toBeHidden();}finally{await fallback.close();}
  const saved=(await f.workspace.read()).book.pages.find(p=>'pages/'+p.id+'.html'===target);expect(saved.sections.filter(s=>s.parentId===saved.sections[0].id)).toHaveLength(6);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('copy values keep whitespace and CRLF exactly; nested popups close independently and unsupported dialogs keep fallback access',async({page})=>{
 const esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),value='  0xAbCd\r\nSecond line\t  ';
 const inner=popupMarkup({title:'Inner',label:'Open inner'},{esc,id:'inner',children:copyTextMarkup({title:'Exact text',body:'',value,label:'Copy exact'},esc)}),outer=popupMarkup({title:'Outer',label:'Open outer'},{esc,id:'outer',children:inner});
 await page.setContent(outer);await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}},configurable:true}));await page.evaluate('('+enhancePublicPopups.toString()+')(document)');
 const outerTrigger=page.locator('summary').first();await outerTrigger.click();const outerDialog=page.getByRole('dialog',{name:'Outer',exact:true});await outerDialog.locator('summary').click();const innerDialog=page.getByRole('dialog',{name:'Inner',exact:true});await innerDialog.getByRole('button',{name:'Copy exact',exact:true}).click();expect(await page.evaluate(()=>window.copied)).toBe(value);
 await page.keyboard.press('Escape');await expect(innerDialog).toBeHidden();await expect(outerDialog.locator('summary')).toBeFocused();await expect(outerDialog).toBeVisible();await page.keyboard.press('Escape');await expect(outerTrigger).toBeFocused();
 await page.setContent(outer);await page.evaluate(()=>{HTMLDialogElement.prototype.showModal=undefined;Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});});await page.evaluate('('+enhancePublicPopups.toString()+')(document)');await outerTrigger.click();await page.locator('summary').nth(1).click();await page.getByRole('button',{name:'Copy exact',exact:true}).click();await expect(page.getByRole('textbox',{name:'Exact text',exact:true})).toBeFocused();await expect(page.getByRole('status')).toHaveText('Automatic copying is unavailable. Select and copy the text above.');
});
