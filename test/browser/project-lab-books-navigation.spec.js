import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {clearVault} from '../../src/encryption.js';

// Workspace > Project > Lab book: every lab book of every project appears
// beneath its project in the navigation, whichever project is open.
test('every lab book appears beneath its project in the navigation, whichever project is open',async({page})=>{
 test.setTimeout(300000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-books-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app;
 try{
  const book=createNotebook('Workspace',''),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  const dialog=page.locator('#dialog'),navigation=page.locator('#workspace-navigation');
  const openProject=async name=>{await navigation.locator('.tree-project-link',{hasText:name}).click();await expect(page.locator('main h1')).toHaveText(name);};
  const createProject=async name=>{await navigation.locator('[data-action=projects]').click();await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill(name);await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText(name);};
  const createBook=async name=>{await page.locator('main').getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill(name);await dialog.getByLabel('Lab-book template',{exact:true}).selectOption('blank');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText(name);
   // Only the open lab book is the current place, not Find work.
   await expect(navigation.locator('[aria-current=page]')).toHaveCount(1);await expect(navigation.locator('[aria-current=page] .tree-title')).toHaveText(name);};
  const booksUnder=name=>navigation.locator('details.tree-project',{has:page.locator('> summary .tree-project-link',{hasText:name})}).locator('.notebook-link .tree-title');
  const projects={'Electronics lab':['Firmware','Measurement rig','Field tests'],'Record label':['Releases','Sessions'],'Insect reserve':['Survey 2026']};
  for(const [project,books] of Object.entries(projects)){await createProject(project);for(const name of books){await openProject(project);await createBook(name);}}
  // A reopened app shows them too, before and after opening each project.
  for(const [round,open] of [['reload',null],...Object.keys(projects).map(name=>['open',name])]){
   if(round==='reload'){await page.reload();await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();}else await openProject(open);
   for(const [project,books] of Object.entries(projects)){
    const shown=await booksUnder(project).allTextContents();
    console.log(round,open,'UNDER',project,JSON.stringify(shown));
    await expect.poll(async()=>(await booksUnder(project).allTextContents()).sort(),{message:round+' '+open+', '+project}).toEqual(books.slice().sort());
   }
  }
  // A link into another lab book keeps the previous page busy and unusable until the lab book is open.
  const openBook=async name=>{await navigation.locator('.notebook-link',{hasText:name}).click();await expect(page.locator('main h1')).toHaveText(name);return page.evaluate(()=>location.hash);};
  const firmware=await openBook('Firmware');await openBook('Releases');
  let release;const held=new Promise(resolve=>{release=resolve;});
  await page.route(/\/lab-books\/[a-f0-9-]{36}\/workspace\/read\//,async route=>{await held;await route.continue();});
  await page.evaluate(hash=>{location.hash=hash;},firmware);
  await expect(page.getByRole('status').filter({hasText:'Opening lab book...'})).toBeVisible();await expect(page.locator('#main')).toHaveAttribute('aria-busy','true');expect(await page.locator('#main').evaluate(main=>main.inert)).toBe(true);
  release();
  await expect(page.locator('main h1')).toHaveText('Firmware');await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');expect(await page.locator('#main').evaluate(main=>main.inert)).toBe(false);
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await owner.close();detach();await Promise.all(vaults.map(clearVault));assert.ok(path.basename(directory).startsWith('observanda-project-books-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
