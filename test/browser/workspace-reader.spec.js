import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {preferences} from './preferences-helper.js';

async function fixture(page){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-pages-ui-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:45},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Take '+i,share:false,body:'Original '+i,sections:[],figures:[],attachments:[],relations:[]}));
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const fullReads=[],read=ResearchCatalogue.prototype.read;
 ResearchCatalogue.prototype.read=function(...args){fullReads.push('read');return read.apply(this,args);};
 const errors=[],requests=[];
 page.on('requestfailed',r=>{if(r.resourceType()==='script')errors.push(new URL(r.url()).pathname+': '+r.failure()?.errorText);});
 page.on('response',r=>{if(r.status()>=400&&r.request().resourceType()==='script')errors.push(new URL(r.url()).pathname+': '+r.status());});
page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/api/workspace/read/'))requests.push({url:r.url(),data:r.postDataJSON()});});
 return {book,ws,app,errors,requests,fullReads,async close(){if(errors.length)console.error('Application load diagnostics:',JSON.stringify(errors));ResearchCatalogue.prototype.read=read;await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
const opened=async(page,f)=>{try{await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();}catch(error){throw Error(error.message+'\nApplication errors: '+JSON.stringify(f?.errors));}};
const openComparison=async(page,f)=>{await page.goto(f.app.url,{waitUntil:'commit'});await opened(page,f);await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[0].id);await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Take 0');await page.getByText('Organize runs or takes',{exact:true}).click();await page.getByRole('button',{name:'View runs and comparisons',exact:true}).click();};
const editable=async page=>expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Take 0');

test('interrupted comparison load stays separate from an empty workspace and retries only the unfinished page',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let pages=0;
 try{
  await page.route('**/api/notebook',route=>route.abort());
  await page.route('**/api/workspace/read/page',async route=>{
   pages++;if(pages===2)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'DATABASE_UNAVAILABLE',message:'Synthetic interrupted connection'})});
   await route.continue();
  });
  await openComparison(page,f);
  await expect(page.getByRole('button',{name:'Retry loading',exact:true})).toBeFocused();
  await expect(page.locator('#workspace-load-progress')).toContainText('20 of 45');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toHaveCount(0);
  await page.keyboard.press('Enter');await editable(page);expect(f.fullReads).toEqual([]);
  const reads=f.requests.filter(r=>r.url.endsWith('/page'));expect(reads).toHaveLength(4);
  expect(reads[2].data.cursor).toBe(reads[1].data.cursor);
  expect(f.requests.filter(r=>r.url.endsWith('/start'))).toHaveLength(2);
  await preferences(page,'General');await page.getByLabel('Workspace name',{exact:true}).fill('Loaded and editable');
  await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Loaded and editable');
  expect((await f.ws.read()).book.entries).toEqual(f.book.entries);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('comparison load can pause and resume by keyboard on a narrow enlarged-text screen',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let pages=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 try{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/workspace/read/page',async route=>{
   pages++;if(pages===2){await gate;try{await route.abort();}catch{}return;}await route.continue();
  });
  await openComparison(page,f);
  await expect(page.locator('#workspace-load-progress')).toHaveText('Loading records 20 of 45');
  await page.evaluate(()=>document.documentElement.style.setProperty('font-size','34px','important'));
  await page.getByRole('button',{name:'Cancel loading',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Resume loading',exact:true})).toBeFocused();release();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('paused-comparison-phone.png')});
  await page.keyboard.press('Enter');await editable(page);
  const reads=f.requests.filter(r=>r.url.endsWith('/page'));expect(reads[2].data.cursor).toBe(reads[1].data.cursor);
  expect(f.errors).toEqual([]);
 }finally{release();await f.close();}
});

test('invalid pages never become a partial book and a clean reload can recover',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let corrupt=true;
 try{
  await page.route('**/api/workspace/read/page',async route=>{
   const response=await route.fetch(),data=await response.json();
   if(corrupt){data.records[1]=data.records[0];corrupt=false;}
   await route.fulfill({response,json:data});
  });
  await openComparison(page,f);
  await expect(page.getByRole('button',{name:'Reload workspace',exact:true})).toBeFocused();
  await expect(page.getByRole('button',{name:'Retry loading',exact:true})).toBeHidden();
  await expect(page.locator('#workspace-load-error')).toContainText('incomplete');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toHaveCount(0);
  await page.keyboard.press('Enter');await editable(page);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('locking during comparison load discards received pages and requires unlocking before opening records',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let pages=0;
 try{
  await page.route('**/api/workspace/read/page',async route=>{
   if(++pages===2){
    const locked=await page.request.post(f.app.origin+'/api/access/lock',{data:{},headers:{Origin:f.app.origin}});
    expect(locked.ok()).toBe(true);
   }
   await route.continue();
  });
  await openComparison(page,f);
  await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toHaveCount(0);
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
