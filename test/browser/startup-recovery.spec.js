import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer as startServer} from '../device-fixture.js';
import {readPreference} from '../../src/locations.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
let app,parent,missing,destination,preferencesFile;
test.beforeEach(async()=>{
 parent=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-browser-'));missing=path.join(parent,'old-default');destination=path.join(parent,'selected-workspace');preferencesFile=path.join(parent,'preferences.json');
 // Reproduce the real CLI startup: a leftover preference, with no workspace on disk.
 await writeFile(preferencesFile,JSON.stringify({formatVersion:1,workspace:missing}));
 const remembered=await readPreference(preferencesFile);app=await startServer({root:remembered,port:0,expectedExisting:!!remembered,preferencesFile});
});
test.afterEach(async()=>{await app.close();});
for(const encrypted of [false,true])test(`missing saved default can create a ${encrypted?'password-encrypted':'device-encrypted'} workspace and reopen it after restarting`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const before=await readFile(preferencesFile,'utf8');
 await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();await expect(page.getByText('Workspace unavailable',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible();await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Cancel new workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();expect(await readFile(preferencesFile,'utf8')).toBe(before);
 await page.getByText('Previous location',{exact:true}).click();await page.getByRole('button',{name:'Retry connection',exact:true}).click();await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();
 await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:test.info().outputPath('startup-choose-workspace.png')});
 await page.getByRole('button',{name:'New workspace',exact:true}).click();await page.getByLabel('Workspace name',{exact:true}).fill('Ready to begin');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Workspace folder',{exact:true}).fill(destination);
 if(encrypted){await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill('synthetic recovery test passphrase');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic recovery test passphrase');}else await page.getByLabel('Use this device',{exact:false}).check();
 await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Ready to begin');expect(await readPreference(preferencesFile)).toBe(destination);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toHaveCount(0);
 await expect(async()=>{await readdir(missing);}).rejects.toMatchObject({code:'ENOENT'});
 await app.close();const remembered=await readPreference(preferencesFile);app=await startServer({root:remembered,port:0,expectedExisting:!!remembered,preferencesFile});await page.goto(app.url);
 if(encrypted){await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();await page.getByLabel('Password',{exact:true}).fill('synthetic recovery test passphrase');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();}
 await expect(page.locator('.workspace-name')).toHaveText('Ready to begin');expect(errors).toEqual([]);
});

test('the previous location can reconnect without being replaced by a new workspace',async({page})=>{
 await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();const book=sampleNotebook();book.title='Reconnected research';await new Workspace(missing).create(book);const before=await readFile(path.join(missing,'observanda.json'),'utf8');
 await page.getByText('Previous location',{exact:true}).click();await page.getByRole('button',{name:'Retry connection',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Reconnected research');expect(await readFile(path.join(missing,'observanda.json'),'utf8')).toBe(before);
});
