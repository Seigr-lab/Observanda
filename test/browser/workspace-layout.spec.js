import {navigate,preferences,editWorkspace} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {TestDeviceStore} from '../device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {initializeLocation} from '../../src/locations.js';
import {clearVault} from '../../src/encryption.js';
import {RecordWriting} from '../../src/record-writing.js';
let app,root,preferencesFile,vault,workspace,book;
// The writing editor stores a rich-text document; one typed line is one paragraph.
const paragraph=text=>({type:'doc',content:[{type:'paragraph',attrs:{align:'inherit'},content:[{type:'text',text}]}]});
// Preferences belong to the computer and stay outside the workspace folder,
// whose name is the displayed workspace name. The workspace uses the current
// database storage: outdated file storage refuses editing and website pages.
test.beforeEach(async({page})=>{const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-layout-'));root=path.join(directory,'Materials studio');preferencesFile=path.join(directory,'preferences.json');book=sampleNotebook();book.title='Materials studio';book.projects[0].title='Long-running environmental research';book.notebooks[0].title='Research records and extended field recordings';const deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',deviceStore);vault=takeCreatedVault(access);await initializeLocation(root,book,access,vault);workspace=new Workspace(root,vault);app=await startServer({root,preferencesFile,deviceStore,port:0});await page.goto(app.url);});test.afterEach(async()=>{await app.close();await clearVault(vault);});
test('workspace identity, legible tree and a persistent draggable and keyboard-resizable sidebar',async({page})=>{
 await expect(page.locator('.topbar')).toContainText('Materials studio');await expect(page.locator('.topbar [data-action=save]')).toHaveCount(0);await expect(page.locator('.workspace-switch')).toHaveCount(0);await expect(page.locator('.sidebar .tree-kind,.sidebar .notebook-link small')).toHaveCount(0);
 const handle=page.getByRole('separator',{name:'Resize navigation'}),box=await handle.boundingBox();await page.mouse.move(box.x+4,box.y+150);await page.mouse.down();await page.mouse.move(box.x+140,box.y+150,{steps:8});await page.mouse.up();await expect(handle).toHaveAttribute('aria-valuenow','408');
 await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8').catch(()=>'{"interface":{}}')).interface.navigationWidth).toBe(408);await page.reload();await expect(page.locator('.sidebar')).toHaveCSS('width','408px');await handle.focus();await page.keyboard.press('ArrowRight');await expect(handle).toHaveAttribute('aria-valuenow','424');await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8').catch(()=>'{"interface":{}}')).interface.navigationWidth).toBe(424);
 await page.screenshot({path:'.local/screenshots/workspace-layout.png',fullPage:true});await page.setViewportSize({width:390,height:844});await expect(handle).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('record footer saves and discards only the current section and policy forms have their own save',async({page})=>{
 // A saved record is edited one area at a time: its writing editor saves or discards only that text.
 await navigate(page,'All records');await page.locator('.records-table').getByRole('link',{name:'Watching a seed unfold',exact:true}).click();await page.getByRole('button',{name:'Edit record',exact:true}).click();
 const summary=page.locator('.record-editing [data-record-edit-area=summary]'),writing=page.getByRole('dialog',{name:'Edit summary / context',exact:true}),stored=async()=>(await new RecordWriting(workspace).read({workspaceId:book.id,recordId:book.entries[0].id,sectionId:null})).value.body;
 await summary.getByRole('button',{name:'Edit summary / context',exact:true}).click();await expect(writing.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();await writing.locator('.ProseMirror').fill('Only this record');await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).not.toBeVisible();await expect(summary).toContainText('Only this record');expect(await stored()).toEqual(paragraph('Only this record'));
 await summary.getByRole('button',{name:'Edit summary / context',exact:true}).click();await writing.locator('.ProseMirror').fill('Unwanted');await writing.getByRole('button',{name:'Discard this edit',exact:true}).click();await writing.getByRole('button',{name:'Discard this edit and its checkpoint?',exact:true}).click();await expect(writing).not.toBeVisible();await expect(summary).toContainText('Only this record');await expect(summary).not.toContainText('Unwanted');expect(await stored()).toEqual(paragraph('Only this record'));
 await preferences(page,'Storage & access');await page.getByLabel('Maximum original file (MiB)',{exact:true}).fill('256');await page.getByRole('button',{name:'Save media limits'}).click();await expect(page.locator('#notice')).toContainText('Media limits saved.');await page.reload();await expect(page.getByLabel('Maximum original file (MiB)',{exact:true})).toHaveValue('256');
 await page.getByLabel('Maximum original file (MiB)',{exact:true}).fill('42');await navigate(page,'Projects');await page.getByRole('dialog',{name:'Unsaved changes'}).getByRole('button',{name:'Discard changes'}).click();await preferences(page,'Storage & access');await expect(page.getByLabel('Maximum original file (MiB)',{exact:true})).toHaveValue('256');
});

test('right-side dragging saves only width while appearance edits still require an explicit save',async({page})=>{
 // App settings and the website design are separate pages: open App appearance from Website design.
 await preferences(page,'Appearance');await expect(page.getByRole('heading',{level:1,name:'Website design',exact:true})).toBeVisible();await page.locator('main .workspace-tabs').getByRole('button',{name:'App appearance',exact:true}).click();await page.locator('[data-disclosure=app-layout] summary').click();await page.getByRole('button',{name:'App layout',exact:true}).click();await page.getByLabel('Menu position',{exact:true}).selectOption('right');await page.getByRole('dialog').getByRole('button',{name:'Save app settings',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
 // Done waits for the save already sent, then closes the dialog; the page behind it is editable only after that.
 await expect(page.locator('#dialog')).not.toBeVisible();
 const original=(await workspace.read()).book.appearance.accent;await page.locator('[data-interface=fontSize]').fill('20');
 // The menu stays as the author left it; open it only when it is closed.
 const handle=page.getByRole('separator',{name:'Resize navigation'});if(!await handle.isVisible())await page.getByRole('button',{name:'Menu',exact:true}).click();const box=await handle.boundingBox();await page.mouse.move(box.x+4,200);await page.mouse.down();await page.mouse.move(box.x-60,200,{steps:6});await page.mouse.up();await expect(handle).toHaveAttribute('aria-valuenow','336');await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8').catch(()=>'{"interface":{}}')).interface.navigationWidth).toBe(336);expect(JSON.parse(await readFile(preferencesFile,'utf8')).interface.fontSize).toBe(17);
 await navigate(page,'Projects');await page.getByRole('dialog',{name:'Unsaved changes'}).getByRole('button',{name:'Discard changes'}).click();await expect(page.locator('#main-navigation')).toBeVisible();await expect(handle).toHaveAttribute('aria-valuenow','336');
 // A pending website design edit is likewise left unsaved by a width change.
 await preferences(page,'Appearance');await page.getByLabel('Accent',{exact:true}).fill('#345678');if(!await handle.isVisible())await page.getByRole('button',{name:'Menu',exact:true}).click();const wider=await handle.boundingBox();await page.mouse.move(wider.x+4,200);await page.mouse.down();await page.mouse.move(wider.x-28,200,{steps:6});await page.mouse.up();await expect(handle).toHaveAttribute('aria-valuenow','368');await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8')).interface.navigationWidth).toBe(368);expect((await workspace.read()).book.appearance.accent).toBe(original);
 await navigate(page,'Projects');await page.getByRole('dialog',{name:'Unsaved changes'}).getByRole('button',{name:'Discard changes'}).click();expect((await workspace.read()).book.appearance.accent).toBe(original);
});

test('a failed record removal leaves the record editable instead of stranding an unsaved list',async({page})=>{
 await navigate(page,'All records');await page.locator('.records-table').getByRole('link',{name:'Watching a seed unfold',exact:true}).click();await page.getByRole('button',{name:'Edit record',exact:true}).click();
 // A saved record is removed from its Actions menu and confirmed in the removal dialog, which reports the failure.
 await page.context().route('**/api/research/records/remove',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic removal failure'})}));const actions=page.locator('[data-disclosure=record-actions]');await actions.locator('summary').click();await actions.getByRole('button',{name:'Remove record',exact:true}).click();
 const removal=page.getByRole('dialog',{name:'Remove record',exact:true});await removal.getByRole('button',{name:'Remove record',exact:true}).click();await expect(removal.getByRole('alert')).toHaveText('Synthetic removal failure');await removal.getByRole('button',{name:'Close',exact:true}).click();await expect(removal).not.toBeVisible();await expect(page.locator('.record-editing h1')).toHaveText('Watching a seed unfold');
 await page.context().unroute('**/api/research/records/remove');const summary=page.locator('.record-editing [data-record-edit-area=summary]'),writing=page.getByRole('dialog',{name:'Edit summary / context',exact:true});await summary.getByRole('button',{name:'Edit summary / context',exact:true}).click();await writing.locator('.ProseMirror').fill('Still editable');await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).not.toBeVisible();await expect(summary).toContainText('Still editable');
 expect((await new RecordWriting(workspace).read({workspaceId:book.id,recordId:book.entries[0].id,sectionId:null})).value.body).toEqual(paragraph('Still editable'));
});
