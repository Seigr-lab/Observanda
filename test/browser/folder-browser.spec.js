import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer} from '../device-fixture.js';
import {browseFolders} from '../../src/folder-browser.js';
import {AppError} from '../../src/errors.js';
let app,parent,root,waiting,entered,cancelled,unavailable;
test.beforeEach(async()=>{
 parent=await mkdtemp(path.join(os.tmpdir(),'observanda-browse-ui-'));root=path.join(parent,'work');
 await mkdir(root);await mkdir(path.join(root,'Offline drive'));await mkdir(path.join(root,'Creative studies'));
 waiting=false;entered=0;cancelled=0;unavailable=false;
 app=await testServer({root,port:0,headless:true,preferencesFile:path.join(parent,'preferences.json'),folderBrowser:async(input,options)=>{
  entered++;
  if(waiting)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{cancelled++;reject(new AppError('FOLDER_CANCELLED'));},{once:true}));
  if(unavailable&&input===path.join(root,'Offline drive'))throw new AppError('FOLDER_TIMEOUT');
  return {...await browseFolders(input,options),placesIncomplete:true};
 }});
});
test.afterEach(async()=>{await app.close();await rm(parent,{recursive:true,force:true});});
async function setup(page){
 await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Creative studies');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill('Retained synthetic password');
}
test('initial discovery is cancellable with the keyboard, restores the form and can be retried',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await setup(page);waiting=true;
 await page.getByRole('button',{name:'Browse server folders',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Choose a folder on the server'});
 await expect(dialog.getByRole('status')).toHaveText('Loading folders...');await expect.poll(()=>entered).toBe(1);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Escape');
 await expect(dialog).not.toBeVisible();await expect.poll(()=>cancelled).toBe(1);
 await expect(page.getByLabel('Password',{exact:true})).toHaveValue('Retained synthetic password');
 await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(root);
 waiting=false;await page.getByRole('button',{name:'Browse server folders',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Creative studies',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(errors).toEqual([]);
});
test('an unavailable folder keeps the current selection usable, including narrow-screen recovery',async({page})=>{
 await setup(page);unavailable=true;await page.getByRole('button',{name:'Browse server folders',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Choose a folder on the server'});
 await expect(dialog.getByRole('status')).toContainText('Some drives did not respond');
 await dialog.getByRole('button',{name:'Offline drive',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('took too long');await expect(dialog.getByRole('button',{name:'Creative studies',exact:true})).toBeEnabled();
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize='20px';});
 await expect(dialog).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await dialog.getByRole('button',{name:'Creative studies',exact:true}).click();
 await expect(dialog.locator('.folder-selection')).toHaveText('Creative studies');
 await dialog.getByRole('button',{name:'Use this folder',exact:true}).click();
 await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(path.join(root,'Creative studies'));
 await expect(page.getByLabel('Password',{exact:true})).toHaveValue('Retained synthetic password');
});
