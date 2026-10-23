import {test,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {RecordValues} from '../../src/record-values.js';
import {encodeNumeralClipboard,decodeNumeralClipboard} from '../../src/web/numeral-clipboard.js';
const context={version:1,representation:'radix-fraction',radix:6};
const encoded=spelling=>encodeNumeralClipboard({spelling,context});

test('fixed field clipboard guards targets and pending reads without consuming unrelated controls',async({page})=>{
 await page.route('https://fields.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;await route.fulfill({contentType:pathname==='/'?'text/html':pathname.endsWith('.json')?'application/json':'text/javascript',body:pathname==='/'?'<main id="host"></main>':await readFile(new URL('../../src/web'+pathname,import.meta.url),'utf8')});});
 await page.goto('https://fields.test/');await page.evaluate(async()=>{
  const {templateFieldInput}=await import('/custom-field-input.js'),{wireCustomFieldClipboard}=await import('/custom-field-clipboard-ui.js'),{encodeNumeralClipboard}=await import('/numeral-clipboard.js');
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const definition={key:'counter',label:'Counter',type:'number',unit:'ticks',required:false,choices:[],numeric:{version:1,representation:'radix-fraction',radix:6}};
  window.encoded=encodeNumeralClipboard({spelling:'-0015.30',context:definition.numeric});window.clipboard=encoded;window.hold=false;window.reads=0;window.release=null;window.changed=0;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>{reads++;return hold?new Promise(resolve=>release=resolve):Promise.resolve(clipboard);},writeText:async value=>{clipboard=value;}}});
  document.getElementById('host').innerHTML='<fieldset>'+templateFieldInput(definition,'0',{esc,attrs:'id="counter"'})+'</fieldset><input id="unrelated" value="ordinary"><button id="other" data-numeral-paste>Other feature</button>';
  document.getElementById('counter').addEventListener('input',()=>changed++);window.dispose=wireCustomFieldClipboard(document.body);
 });
 const value=page.locator('#counter'),button=page.locator('[data-custom-field-number] [data-numeral-paste]'),status=page.locator('[data-numeral-status]');
 await page.locator('#other').click();expect(await page.evaluate(()=>reads)).toBe(0);
 await button.click();await expect(value).toHaveValue('-0015.30');expect(await page.evaluate(()=>changed)).toBe(1);
 for(const restriction of ['readOnly','disabled','inert','fieldset']){
  await page.evaluate(kind=>{const node=document.getElementById('counter');node.value='kept';if(kind==='inert')node.parentElement.inert=true;else if(kind==='fieldset')node.closest('fieldset').disabled=true;else node[kind]=true;},restriction);
  const before=await page.evaluate(()=>reads);await button.evaluate(node=>node.click());expect(await page.evaluate(()=>reads)).toBe(before);await expect(value).toHaveValue('kept');
  await page.evaluate(kind=>{const node=document.getElementById('counter');if(kind==='inert')node.parentElement.inert=false;else if(kind==='fieldset')node.closest('fieldset').disabled=false;else node[kind]=false;},restriction);
 }
 for(const restriction of ['readOnly','disabled','inert','fieldset']){
  await page.evaluate(()=>{hold=true;release=null;});await button.click();await expect.poll(()=>page.evaluate(()=>typeof release)).toBe('function');
  await page.evaluate(kind=>{const node=document.getElementById('counter');if(kind==='inert')node.parentElement.inert=true;else if(kind==='fieldset')node.closest('fieldset').disabled=true;else node[kind]=true;hold=false;release(encoded);},restriction);await expect(value).toHaveValue('kept');
  await page.evaluate(kind=>{const node=document.getElementById('counter');if(kind==='inert')node.parentElement.inert=false;else if(kind==='fieldset')node.closest('fieldset').disabled=false;else node[kind]=false;},restriction);
 }
 await page.evaluate(()=>{hold=true;release=null;});await button.click();await value.fill('later');await page.evaluate(()=>{hold=false;release(encoded);});await expect(status).toContainText('Your edit was kept');await expect(value).toHaveValue('later');
 await page.evaluate(()=>{hold=true;release=null;});await button.click();await page.evaluate(()=>{const old=document.getElementById('counter'),replacement=old.cloneNode();old.replaceWith(replacement);hold=false;release(encoded);});await expect(value).toHaveValue('later');await expect(status).toContainText('Your edit was kept');
 await page.evaluate(()=>{hold=true;release=null;});await button.click();await page.evaluate(()=>{dispose();document.getElementById('host').innerHTML='<input id="counter" value="replacement">';release(encoded);});await expect(value).toHaveValue('replacement');
});

test('native custom fields copy matching senary context, refuse mismatches and retain saved schema on reopen',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-field-clipboard-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];
 record.template={id:randomUUID(),profileId:null,label:'Explicit measurements',description:'',fields:[{key:'counter',label:'Senary counter',type:'number',unit:'ticks',required:false,choices:[],numeric:context}],values:{counter:'-0015.30'}};
 const f=await encryptedFixture(directory,book),service=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'template:counter'},app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const open=async()=>{await page.locator('[data-record-detail-field]').selectOption('template:counter');await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();};
 const dialog=page.locator('dialog[aria-labelledby="values-value-title"]'),value=dialog.locator('[data-custom-field-spelling]'),status=dialog.locator('[data-numeral-status]');
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();await open();
  await dialog.getByRole('button',{name:'Copy spelling and interpretation',exact:true}).click();await expect(status).toContainText('copied');expect(decodeNumeralClipboard(await page.evaluate(()=>navigator.clipboard.readText()))).toEqual({kind:'typed',spelling:'-0015.30',context});
  await value.fill('0');await dialog.getByRole('button',{name:'Paste spelling and interpretation',exact:true}).click();await expect(value).toHaveValue('-0015.30');
  await page.evaluate(value=>navigator.clipboard.writeText(value),encodeNumeralClipboard({spelling:'10',context:{version:1,representation:'decimal',radix:10}}));await dialog.getByRole('button',{name:'Paste spelling and interpretation',exact:true}).click();await expect(status).toContainText('different numeral interpretation');await expect(value).toHaveValue('-0015.30');expect((await service.read(target)).definition.numeric).toEqual(context);
  await page.evaluate(()=>navigator.clipboard.writeText('10'));await dialog.getByRole('button',{name:'Paste spelling and interpretation',exact:true}).click();await expect(status).toContainText('Plain text');await expect(value).toHaveValue('10');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();expect((await service.read(target)).value.value).toBe('10');
  await open();await value.focus();await page.evaluate(payload=>navigator.clipboard.writeText(payload),encoded('-0015.30'));await page.keyboard.press('Control+V');await expect(value).toHaveValue('-0015.30');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.reload();await open();await expect(value).toHaveValue('-0015.30');const saved=await service.read(target);expect(saved.definition.numeric).toEqual(context);expect(saved.value.value).toBe('-0015.30');expect(errors).toEqual([]);await dialog.getByRole('button',{name:'Close',exact:true}).click();
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
