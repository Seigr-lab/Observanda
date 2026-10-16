import {readAccess,verifyAccess} from '../../src/access.js';
import {TestDeviceStore as DeviceStore} from '../device-fixture.js';
import {preferences,editWorkspace} from './preferences-helper.js';
import {laboratoryProfiles} from '../../src/web/laboratory/catalog.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer as startServer} from '../device-fixture.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {workspaceManifest} from '../../src/locations.js';
import {encrypted} from '../../src/encryption.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {randomUUID} from 'node:crypto';
let app,root,parent,owner,detach;
test.beforeEach(async()=>{parent=await mkdtemp(path.join(os.tmpdir(),'observanda-setup-'));root=path.join(parent,'workspace');app=await startServer({root,port:0,headless:true,preferencesFile:path.join(parent,'preferences.json')});});
test.afterEach(async()=>{try{await app.close();}finally{try{await owner?.close();}finally{detach?.();owner=detach=null;}}if(path.dirname(parent)!==path.resolve(os.tmpdir())||!path.basename(parent).startsWith('observanda-setup-'))throw Error('Unexpected test root');await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
const next=page=>page.getByRole('button',{name:'Continue',exact:true}).click();
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);

test('setup has stable context, staged validation and accessible reflow without marketing or starter research',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
 await expect(page.getByText('Start with a question',{exact:true})).toHaveCount(0);await expect(page.getByText('OBS / FIELD JOURNAL',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('First project name')).toHaveCount(0);await expect(page.getByLabel('First notebook name')).toHaveCount(0);await expect(page.locator('.setup-themes')).toHaveCount(0);await expect(page.getByRole('button',{name:'Text size',exact:true})).toHaveCount(0);await expect(page.getByText('Appearance',{exact:true})).toHaveCount(0);expect(await page.getByLabel('Workspace name',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
 await next(page);await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible();
 await page.getByLabel('Workspace name',{exact:true}).fill('Research Workspace 1');
 await page.evaluate(()=>document.fonts.ready);const before=await page.locator('.setup-footer').boundingBox();await page.getByLabel('Workspace type').selectOption('custom');await page.getByLabel('Your own label').fill('Atelier');const after=await page.locator('.setup-footer').boundingBox();expect(Math.abs(before.y-after.y)).toBeLessThan(1);
 await page.screenshot({path:test.info().outputPath('setup-workspace.png'),fullPage:true});
 await next(page);await next(page);await page.getByLabel('Use this device',{exact:false}).check();await expect(page.getByRole('button',{name:'Create workspace',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Your own label')).toHaveValue('Atelier');
 await page.setViewportSize({width:390,height:844});expect(await overflow(page)).toBe(false);await page.screenshot({path:test.info().outputPath('setup-workspace-mobile.png'),fullPage:true});
 await next(page);await next(page);expect(await overflow(page)).toBe(false);
 await expect(page.getByLabel('Create in',{exact:true})).toHaveValue(parent);const checked=page.waitForResponse(r=>r.url().endsWith('/api/storage/check'));await page.getByRole('button',{name:'Check folder',exact:true}).click();expect((await (await checked).json()).root).toBe(path.join(parent,'Research Workspace 1'));await expect(page.getByLabel('Create in',{exact:true})).toHaveValue(parent);
 await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Research Workspace 1');
 root=path.join(parent,'Research Workspace 1');const vault=await verifyAccess(await readAccess(root),'','',{deviceStore:new DeviceStore({file:path.join(parent,'preferences.json.device-key')})});const saved=await new Workspace(root,vault).read();expect(saved.book.projects).toEqual([]);expect(saved.book.notebooks).toEqual([]);expect(saved.book.entries).toEqual([]);expect(errors).toEqual([]);
});

test('encrypted setup retains fields after a failed request, writes no readable research and unlocks after restart',async({page})=>{
 await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Private research marker');await next(page);await page.getByRole('checkbox',{name:/^Computer/}).check();await next(page);
 await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill('synthetic private password');await page.getByLabel('Confirm password',{exact:true}).fill('synthetic private password');
 await page.screenshot({path:test.info().outputPath('setup-protection.png'),fullPage:true});
 await page.route('**/api/notebook/create',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic creation failure'})}));
 await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.setup-error')).toHaveText('Synthetic creation failure');await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Private research marker');await expect(page.getByLabel('Password',{exact:true})).toHaveValue('synthetic private password');
 await expect(page.getByRole('checkbox',{name:/^Computer/,includeHidden:true})).toBeChecked();await page.unroute('**/api/notebook/create');await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Private research marker');
 root=path.join(parent,'Private research marker');expect(encrypted(await readFile(path.join(root,'workspace.observanda')))).toBe(true);const remembered=JSON.parse(await readFile(path.join(parent,'preferences.json'),'utf8'));expect(remembered.workspace).toBe(root);expect(remembered.recent[0].title).toBe('');
 await app.close();app=await startServer({root,port:0,headless:true,preferencesFile:path.join(parent,'preferences.json')});await page.goto(app.url);await expect(page.getByRole('heading',{name:'Unlock workspace'})).toBeVisible();
 await page.getByLabel('Password',{exact:true}).fill('synthetic private password');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Private research marker');
});

test('encrypted-copy review protects all existing files and retains the original byte for byte',async({page})=>{
 const ws=new Workspace(root),initial=await ws.create({...sampleNotebook(),title:path.basename(root)});initial.book.description='A retained revision';await ws.save(initial.book,initial.etag);const before=await workspaceManifest(root),destination=path.join(parent,'encrypted-copy');
 await page.goto(app.url);await preferences(page,'Storage & access');await page.getByRole('button',{name:'Create encrypted copy',exact:true}).click();
 await page.getByLabel('Workspace folder').fill(destination);await page.getByLabel('Workspace password',{exact:true}).fill('converted private password');await page.getByLabel('Confirm password',{exact:true}).fill('converted private password');
 await page.getByRole('button',{name:'Review encrypted copy',exact:true}).click();await expect(page.locator('[data-encryption-review]')).toContainText('Ready to encrypt');
 await page.getByRole('button',{name:'Encrypt and use this copy',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible();await preferences(page,'Storage & access');await expect(page.getByRole('heading',{name:'Encrypted workspace',exact:true})).toBeVisible();
 expect(await workspaceManifest(root)).toEqual(before);for(const file of await workspaceManifest(destination))if(file.path!=='.observanda/access.json')expect(encrypted(await readFile(path.join(destination,file.path)))).toBe(true);
 await page.locator('main').getByRole('button',{name:'Lock workspace',exact:true}).click();await page.getByLabel('Password',{exact:true}).fill('converted private password');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText(path.basename(destination));
});


test('headless server folder navigation creates a folder and retains setup details',async({page})=>{
 await mkdir(root);await mkdir(path.join(root,'Experiments'));await mkdir(path.join(root,'Field notes'));
 await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Folder selection test');await next(page);await next(page);
 await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill('retained private password');
 await page.getByLabel('Create in',{exact:true}).fill(root);await page.getByRole('button',{name:'Browse server folders',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Choose a folder on the server'});
 await expect(dialog.getByRole('navigation',{name:'Places',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Experiments',exact:true}).click();await expect(dialog.locator('.folder-selection')).toHaveText('Experiments');
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await expect(dialog.getByRole('button',{name:'Field notes',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Forward',exact:true}).click();await expect(dialog.locator('.folder-selection')).toHaveText('Experiments');
 await dialog.getByRole('button',{name:'Up one folder',exact:true}).click();
 await dialog.getByRole('searchbox',{name:'Search this folder'}).fill('Field');await expect(dialog.locator('.folder-row')).toHaveCount(1);
 await dialog.getByRole('searchbox',{name:'Search this folder'}).fill('');await expect(dialog.locator('.folder-row')).toHaveCount(2);
 await dialog.getByRole('button',{name:'New folder',exact:true}).click();await dialog.getByLabel('New folder name',{exact:true}).fill('Experiments');await dialog.getByRole('button',{name:'Create folder',exact:true}).click();await expect(dialog.locator('[data-folder-error]')).toContainText('already exists');
 await dialog.getByLabel('New folder name',{exact:true}).fill('Archive');await dialog.getByRole('button',{name:'Create folder',exact:true}).click();await expect(dialog.locator('.folder-selection')).toHaveText('Archive');
 await page.screenshot({path:test.info().outputPath('folder-picker-desktop.png')});await page.setViewportSize({width:390,height:844});expect(await overflow(page)).toBe(false);await page.screenshot({path:test.info().outputPath('folder-picker-mobile.png')});
 await dialog.getByRole('button',{name:'Use this folder',exact:true}).click();await expect(page.getByLabel('Create in',{exact:true})).toHaveValue(path.join(root,'Archive'));await expect(page.getByLabel('Password',{exact:true})).toHaveValue('retained private password');
 await page.getByRole('button',{name:'Browse server folders',exact:true}).click();await dialog.getByRole('button',{name:'Up one folder',exact:true}).click();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByLabel('Create in',{exact:true})).toHaveValue(path.join(root,'Archive'));
});

test('appearance is reached from its own section after setup and offers a full-size component preview',async({page})=>{
 await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Independent work');await next(page);await next(page);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 await expect(page.locator('.workspace-name')).toHaveText('Independent work');await expect(page.locator('main [data-action="new-project"]')).toHaveCount(1);await expect(page.locator('.topbar [data-action="interface-layout"],.topbar [data-action="interface-text"],main [data-action="branding"],main [data-action="website"],main [data-action="laboratory"]')).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('workspace-empty.png')});
 await preferences(page,'Appearance');await page.getByRole('button',{name:/Studio/}).click();await page.locator('.section-save [data-action=save]').click();
 await expect(page.frameLocator('#design-preview').getByRole('heading',{name:'Projects',exact:true})).toBeVisible();await page.getByRole('button',{name:'Expand preview',exact:true}).click();await expect(page.frameLocator('iframe[title="Expanded design preview"]').getByRole('heading',{name:'Projects',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('theme-preview-expanded.png')});await page.getByRole('button',{name:'Close preview',exact:true}).click();
 root=path.join(parent,'Independent work');const vault=await verifyAccess(await readAccess(root),'','',{deviceStore:new DeviceStore({file:path.join(parent,'preferences.json.device-key')})});const saved=(await new Workspace(root,vault).read()).book;expect(saved.appearance.theme).toBe('studio');expect(saved.appearance.header).toBe('band');expect(saved.projects).toHaveLength(0);
});

test('setup and module preferences govern the same project and lab-book template choices',async({page})=>{
 test.setTimeout(90000);owner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(owner);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),dialog=page.locator('#dialog');
 await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Shared template selection');await next(page);
 const choices=page.getByRole('group',{name:'Lab-book types',exact:true});await expect(choices.getByRole('checkbox')).toHaveCount(laboratoryProfiles.length);
 const labels=await choices.getByRole('checkbox').evaluateAll(nodes=>nodes.map(n=>n.labels[0].textContent.trim()));expect(labels).toEqual([...labels].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'})));
 for(const checkbox of await choices.getByRole('checkbox').all())await expect(checkbox).not.toBeChecked();
 await choices.getByRole('checkbox',{name:/^Computer/}).focus();await page.keyboard.press('Space');await choices.getByRole('checkbox',{name:/^Arts & creative practice/}).check();await choices.getByRole('checkbox',{name:/^Beekeeping/}).check();
 await page.screenshot({path:test.info().outputPath('setup-types-desktop.png'),fullPage:true});
 await next(page);await page.getByRole('button',{name:'Back',exact:true}).click();await expect(choices.getByRole('checkbox',{name:/^Computer/})).toBeChecked();
 await page.setViewportSize({width:390,height:844});expect(await overflow(page)).toBe(false);expect(await page.locator('.setup-progress li').evaluateAll(items=>items.every(item=>item.scrollWidth<=item.clientWidth+1))).toBe(true);await page.screenshot({path:test.info().outputPath('setup-types-narrow.png')});
 await next(page);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Shared template selection',{timeout:60000});
 await page.setViewportSize({width:1440,height:1000});await expect(page.locator('html')).toHaveAttribute('data-context-navigation','open');
 await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('IT wing');
 const starter=()=>dialog.getByLabel('Default lab-book template',{exact:true});
 await expect(starter().locator('optgroup[label="Lab-book types"] option')).toHaveText(['Arts & creative practice','Beekeeping','Computer / IT']);await expect(dialog.getByRole('button',{name:'Enable and use template',exact:true})).toHaveCount(0);
 await dialog.getByLabel('Project type',{exact:true}).selectOption('profile:computer-it');await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await main.getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill('Build journal');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible();
 await preferences(page,'Modules');const types=main.getByRole('group',{name:'Lab-book types',exact:true});await expect(types.getByRole('switch',{name:'Enable Computer / IT',exact:true})).toBeChecked();await expect(types.getByRole('switch',{name:'Enable Clinical & medical',exact:true})).not.toBeChecked();
 await types.getByRole('switch',{name:'Enable Computer / IT',exact:true}).uncheck();const persisted=page.waitForResponse(r=>r.url().endsWith('/api/dashboard/pending')&&r.request().method()==='POST'&&r.ok());await types.getByRole('switch',{name:'Enable Educational',exact:true}).check();await persisted;await page.reload();await expect(main.getByRole('switch',{name:'Enable Educational',exact:true})).toBeChecked();
 await page.locator('#main-navigation [data-action="open-project"]').click();await main.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(starter().locator('optgroup[label="Lab-book types"] option')).toHaveText(['Arts & creative practice','Beekeeping','Educational']);await expect(starter().locator('optgroup[label="Saved project templates"]')).toHaveCount(0);await expect(dialog.getByLabel('Custom project type',{exact:true})).toHaveValue('Computer / IT');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await main.getByRole('button',{name:'New lab book',exact:true}).click();await expect(dialog.getByRole('option',{name:'Computer / IT',exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Lab-book template',{exact:true})).toHaveValue('blank');await expect(dialog.getByLabel('Record type name',{exact:true})).toHaveCount(0);await expect(dialog).toContainText('The project default uses a type that is turned off');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await main.getByRole('button',{name:'Lab book settings',exact:true}).click();await expect(dialog.getByLabel('Record type name',{exact:true})).toHaveValue('Environments & builds');await expect(dialog.getByLabel('Computer / IT',{exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await preferences(page,'Modules');await main.getByRole('switch',{name:'Enable Computer / IT',exact:true}).check();await page.locator('#main-navigation [data-action="open-project"]').click();await main.getByRole('button',{name:'New lab book',exact:true}).click();await expect(dialog.getByLabel('Lab-book template',{exact:true}).locator('option:checked')).toHaveText('Computer / IT (project default)');await expect(dialog.getByLabel('Record type name',{exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(errors).toEqual([]);
});
