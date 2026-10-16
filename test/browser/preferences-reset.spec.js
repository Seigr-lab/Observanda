import {preferences,editWorkspace} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer as startServer} from '../device-fixture.js';
import {initializeLocation,workspaceManifest} from '../../src/locations.js';
import {createNotebook} from '../../src/model.js';
import {createAccess} from '../../src/access.js';
import {defaultPreferences,readPreferences,rememberLocation,rememberInterface} from '../../src/preferences.js';
let app,parent,root,file;
test.beforeEach(async()=>{parent=await mkdtemp(path.join(os.tmpdir(),'observanda-reset-browser-'));root=path.join(parent,'old-workspace');file=path.join(parent,'preferences.json');await rememberLocation(file,root);await rememberInterface(file,{fontSize:24,lineHeight:1.9});});
test.afterEach(async()=>{await app?.close();});

test('reset from a missing location cancels safely, then restarts the complete wizard across reloads',async({page})=>{
 app=await startServer({root,port:0,preferencesFile:file,expectedExisting:true});const original=await readFile(file);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url);await page.getByText('Previous location',{exact:true}).click();await expect(page.getByText(file,{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Reset app preferences',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Reset app preferences',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await readFile(file)).toEqual(original);
 await page.getByRole('button',{name:'Reset app preferences',exact:true}).click();await dialog.getByRole('button',{name:'Reset and restart setup',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible();expect(await readPreferences(file)).toEqual(defaultPreferences());
 const backup=(await readdir(parent)).find(name=>name.includes('before-reset'));expect(await readFile(path.join(parent,backup))).toEqual(original);await expect(async()=>readdir(root)).rejects.toMatchObject({code:'ENOENT'});
 await page.reload();await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Text size',exact:true})).toHaveCount(0);await expect(page.getByText('Previous location',{exact:true})).toHaveCount(0);
 await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:test.info().outputPath('preferences-reset-setup.png')});
 await page.getByLabel('Workspace name',{exact:true}).fill('New research');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();const destination=path.join(parent,'fresh-workspace');await page.getByLabel('Workspace folder',{exact:true}).fill(destination);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 await expect(page.locator('.workspace-name')).toHaveText('New research');expect((await readPreferences(file)).workspace).toBe(destination);
 await preferences(page,'Storage & access');await expect(page.getByText(file,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Reset app preferences',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('reset from an open workspace preserves files and asks before abandoning unsaved access edits',async({page})=>{
 await initializeLocation(root,createNotebook('Protected research'),await createAccess('Owner','synthetic reset password'));const before=await workspaceManifest(root);
 app=await startServer({root,port:0,preferencesFile:file,expectedExisting:true});await page.goto(app.url);await page.getByLabel('Username',{exact:true}).fill('Owner');await page.getByLabel('Password',{exact:true}).fill('synthetic reset password');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await preferences(page,'Storage & access');
 await page.getByLabel('Username (optional)',{exact:true}).fill('Unwanted edit');await page.getByRole('button',{name:'Reset app preferences',exact:true}).click();const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Stay here',exact:true}).click();await expect(page.getByLabel('Username (optional)',{exact:true})).toHaveValue('Unwanted edit');
 await page.getByRole('button',{name:'Reset app preferences',exact:true}).click();await guard.getByRole('button',{name:'Discard changes',exact:true}).click();await page.getByRole('button',{name:'Reset and restart setup',exact:true}).click();await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible();expect(await workspaceManifest(root)).toEqual(before);
 await page.getByRole('button',{name:'Open existing workspace',exact:true}).click();await page.getByRole('dialog').getByLabel('Workspace folder',{exact:true}).fill(root);await page.getByLabel('Workspace username (if protected)',{exact:true}).fill('Owner');await page.getByLabel('Workspace password (if protected)',{exact:true}).fill('synthetic reset password');await page.getByRole('dialog').getByRole('button',{name:'Open workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Protected research');expect(await workspaceManifest(root)).toEqual(before);
});
