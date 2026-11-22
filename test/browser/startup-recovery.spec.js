import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer as startServer,TestDeviceStore} from '../device-fixture.js';
import {readPreference,initializeLocation} from '../../src/locations.js';
import {Workspace} from '../../src/storage.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import setupMessages from '../../src/web/locales/en/setup.json' with {type:'json'};
// Setup asks where to create the workspace; its folder takes the workspace's name.
const createIn=page=>page.getByLabel(setupMessages.parentFolder,{exact:true});
let app,parent,missing,destination,preferencesFile;
test.beforeEach(async()=>{
 parent=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-browser-'));missing=path.join(parent,'old-default');destination=path.join(parent,'Ready to begin');preferencesFile=path.join(parent,'preferences.json');
 // Reproduce the real CLI startup: a leftover preference, with no workspace on disk.
 await writeFile(preferencesFile,JSON.stringify({formatVersion:1,workspace:missing}));
 const remembered=await readPreference(preferencesFile);app=await startServer({root:remembered,port:0,expectedExisting:!!remembered,preferencesFile});
});
test.afterEach(async()=>{await app.close();});
for(const encrypted of [false,true])test(`missing saved default can create a ${encrypted?'password-encrypted':'device-encrypted'} workspace and reopen it after restarting`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const before=await readFile(preferencesFile,'utf8');
 await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();await expect(page.getByText('Workspace unavailable',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible();await expect(createIn(page)).not.toHaveValue(missing);
 await page.getByRole('button',{name:'Cancel new workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();expect(await readFile(preferencesFile,'utf8')).toBe(before);
 await page.getByText('Previous location',{exact:true}).click();await page.getByRole('button',{name:'Retry connection',exact:true}).click();await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('startup-choose-workspace.png')});
 await page.getByRole('button',{name:'New workspace',exact:true}).click();await page.getByLabel('Workspace name',{exact:true}).fill('Ready to begin');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await createIn(page).fill(parent);
 if(encrypted){await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill('synthetic recovery test passphrase');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic recovery test passphrase');}else await page.getByLabel('Use this device',{exact:false}).check();
 await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Ready to begin');expect(await readPreference(preferencesFile)).toBe(destination);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toHaveCount(0);
 await expect(async()=>{await readdir(missing);}).rejects.toMatchObject({code:'ENOENT'});
 await app.close();const remembered=await readPreference(preferencesFile);app=await startServer({root:remembered,port:0,expectedExisting:!!remembered,preferencesFile});await page.goto(app.url);
 if(encrypted){await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();await page.getByLabel('Password',{exact:true}).fill('synthetic recovery test passphrase');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();}
 await expect(page.locator('.workspace-name')).toHaveText('Ready to begin');expect(errors).toEqual([]);
});

test('the previous location can reconnect without being replaced by a new workspace',async({page})=>{
 await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();
 // The folder name is the workspace name; the test server keeps its device store next to the preferences file.
 const book=sampleNotebook();book.title=path.basename(missing);const access=await createWorkspaceAccess('','',new TestDeviceStore({file:preferencesFile+'.device-key'})),vault=takeCreatedVault(access);
 try{
  await initializeLocation(missing,book,access,vault);const workspace=new Workspace(missing,vault),before=(await workspace.read()).etag;
  await page.getByText('Previous location',{exact:true}).click();await page.getByRole('button',{name:'Retry connection',exact:true}).click();
  // This device opens the reconnected workspace without a password; its first opening reads it in full.
  await expect(page.locator('.workspace-name')).toHaveText(book.title,{timeout:30000});expect((await workspace.read()).etag).toBe(before);
 }finally{await clearVault(vault);}
});
