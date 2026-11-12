import {test,expect} from './document-editor-fixture.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {RecordQuery} from '../../src/record-query.js';
import {AppError} from '../../src/errors.js';
import {encryptedFixture} from './encrypted-fixture.js';

test('every shipping interface language survives record filtering and link lookup failures during writing',async({page})=>{
 test.setTimeout(210000);page.setDefaultTimeout(10000);
 const languages=await catalogue('languages.json');
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-language-writing-'));
 let storage,app,pauseLookup,disconnected=false;
 const originalList=RecordQuery.prototype.list;
 RecordQuery.prototype.list=async function(data,...options){
  if(data.limit===25&&pauseLookup)await pauseLookup;
  if(disconnected&&data.query?.search==='survey')throw new AppError('IO');
  return originalList.call(this,data,...options);
 };
 async function catalogue(file){return JSON.parse(await readFile(new URL('../../src/web/locales/'+file,import.meta.url),'utf8'));}
 try{
  const book=upgradeNotebook(sampleNotebook()),original=book.entries[2];
  book.entries=Array.from({length:32},(_,i)=>({...structuredClone(original),id:randomUUID(),title:'Survey '+(i+1),body:'Field note.',sections:[],relations:[],figures:[],attachments:[]}));
  storage=await encryptedFixture(directory,book);
  app=await testServer({root:storage.workspace.root,deviceStore:storage.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.url);await page.setViewportSize({width:1024,height:768});
  for(const language of languages){
   const locale=language.id;
   const [writing,labels,records]=await Promise.all(['recordWriting','book','recordLists'].map(name=>catalogue(locale+'/'+name+'.json')));
   await page.evaluate(()=>location.hash='#/preferences/help');
   await page.locator('[data-language-choice]').selectOption(locale);await expect(page.locator('html')).toHaveAttribute('lang',locale);
   await page.evaluate(()=>location.hash='#/records');
   const filters=page.locator('.record-browse');
   if(!await filters.evaluate(el=>el.open))await filters.locator('summary').click();
   const field=name=>page.locator('[data-record-browse="'+name+'"]');
   await field('from').fill('2026-09-30');await field('to').fill('2026-09-18');
   await expect(page.locator('.record-filter-error')).toHaveText(records.reversedDateRange);
   await field('dateKnowledge').selectOption('unknown');await expect(page.locator('.record-filter-error')).toHaveText(records.unknownDateRange);
   await page.locator('[data-action="clear-record-filters"]').first().click();
   await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
   await page.getByRole('button',{name:writing.summary,exact:true}).click();
   const dialog=page.locator('dialog.record-writing[open]'),editor=dialog.getByRole('textbox',{name:writing.body,exact:true});
   await expect(editor).toHaveText('Field note.');
   await editor.focus();await editor.press('End');await page.keyboard.insertText('a'.repeat(60001));
   await expect(page.locator('#notice')).toContainText(labels.capacityCharacters.replace('{remaining}',String(60000-'Field note.'.length)).replace('{limit}','60000'));
   await expect(editor).toHaveText('Field note.');
   // Hold only the first real lookup so its loading label is observable.
   let release;pauseLookup=new Promise(resolve=>{release=resolve;});
   await dialog.locator('[data-rich-command="link"]').click();
   const link=page.locator('dialog.rich-link-panel[open]'),results=link.locator('.text-link-targets');
   try{await expect(results).toHaveText(labels.selectorLoading);}finally{pauseLookup=null;release();}
   const next=link.getByRole('button',{name:labels.selectorNext,exact:true});
   await next.click();await expect(link.getByRole('button',{name:labels.selectorPrevious,exact:true})).toBeVisible();
   const search=link.locator('[data-rich-search]');
   await search.fill('No such observation');await expect(results).toHaveText(labels.editorEmptyDestinations);
   disconnected=true;
   await search.fill('Survey');await expect(results.getByRole('alert')).toHaveText(labels.editorDestinationsFailed);
   disconnected=false;
   const retry=results.getByRole('button',{name:labels.editorRetryDestinations,exact:true});
   await retry.focus();await page.keyboard.press('Enter');await expect(next).toBeVisible();
   expect(await link.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   await link.locator('[data-rich-command="link-cancel"]').click();
   await dialog.getByRole('button',{name:writing.close,exact:true}).click();
  }
 }finally{RecordQuery.prototype.list=originalList;await app?.close();if(storage)await clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:80});}
});
