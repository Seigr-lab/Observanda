import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,readdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer as startServer} from '../device-fixture.js';
import {createNotebook} from '../../src/model.js';
import {createAccess} from '../../src/access.js';
import {initializeLocation} from '../../src/locations.js';
let app,parent,root,selected,calls,result,finish;
test.beforeEach(async()=>{
 parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-browser-'));root=path.join(parent,'workspace');selected=path.join(parent,"Chosen O'Brien & \u03bc");await mkdir(selected);calls=[];result={folder:selected,cancelled:false};finish=null;
 const picker={capabilities:async()=>({mode:'native',backend:'windows'}),choose:async request=>{calls.push(request.initialPath);return typeof result==='function'?result():result;}};
 app=await startServer({root,port:0,preferencesFile:path.join(parent,'preferences.json'),folderPicker:picker});
});
test.afterEach(async()=>{finish?.({folder:null,cancelled:true});await app.close();});

test('desktop setup uses the OS picker, keeps form values and does not create a workspace until submitted',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Native selection');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill('Retained field value');
 await page.getByRole('button',{name:'Choose folder',exact:true}).click();await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(selected);await expect(page.locator('.folder-browser')).toHaveCount(0);expect(calls).toEqual([root]);expect(await readdir(selected)).toEqual([]);await expect(page.getByLabel('Password',{exact:true})).toHaveValue('Retained field value');
 result={folder:null,cancelled:true};await page.getByRole('button',{name:'Choose folder',exact:true}).click();await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(selected);expect(calls).toEqual([root,selected]);
 await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Native selection');expect(JSON.parse(await readFile(path.join(parent,'preferences.json'),'utf8')).workspace).toBe(selected);expect(errors).toEqual([]);
});

test('open-workspace dialogs retain credentials and their modal context when the native picker returns',async({page})=>{
 await initializeLocation(selected,createNotebook('Existing research'),await createAccess());await page.goto(app.url);await page.getByRole('button',{name:'Open existing workspace',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Open an existing workspace',exact:true});await dialog.getByLabel('Workspace username (if protected)',{exact:true}).fill('Retained username');
 await dialog.getByRole('button',{name:'Choose folder',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Workspace folder',{exact:true})).toHaveValue(selected);await expect(dialog.getByLabel('Workspace username (if protected)',{exact:true})).toHaveValue('Retained username');await expect(page.locator('.folder-browser')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Open workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Existing research');
});

test('a pending native dialog blocks duplicate requests and leaves setup usable after it is cancelled',async({page})=>{
 result=()=>new Promise(resolve=>finish=resolve);await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Pending selection');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Choose folder',exact:true}).click();
 await expect(page.getByRole('button',{name:'Selecting folder...',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Create workspace',exact:true})).toBeDisabled();await expect.poll(()=>calls.length).toBe(1);finish({folder:null,cancelled:true});
 await expect(page.getByRole('button',{name:'Choose folder',exact:true})).toBeEnabled();await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(root);await expect(page.getByRole('button',{name:'Create workspace',exact:true})).toBeEnabled();
});

test('native dialog errors preserve the entered location and allow a retry',async({page})=>{
 await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Retry selection');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.route('**/api/storage/pick',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({message:'The system folder picker could not open.'})}));
 await page.getByRole('button',{name:'Choose folder',exact:true}).click();await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(root);await expect(page.getByRole('button',{name:'Choose folder',exact:true})).toBeEnabled();await expect(page.locator('#notice')).toContainText('could not open');
 await page.unroute('**/api/storage/pick');await page.getByRole('button',{name:'Choose folder',exact:true}).click();await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(selected);
});
