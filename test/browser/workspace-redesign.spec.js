import {sessionRequest} from './session-fixture.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {sampleNotebook} from '../../src/sample.js';
import {navigate} from './preferences-helper.js';
let app,root,book,errors,fixture;
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));root=await mkdtemp(path.join(os.tmpdir(),'observanda-redesign-'));book=sampleNotebook();book.website.description='';fixture=await encryptedFixture(root,book);app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});await page.goto(app.url);});
test.afterEach(async()=>{await app?.close();if(fixture)await clearVault(fixture.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
test('dashboard editing uses the selected card and keeps its layout separate from research',async({page})=>{
 const before=(await fixture.workspace.read()).book.entries;await navigate(page,'Dashboard');await page.getByRole('button',{name:'Settings for Recent records',exact:true}).click();const inspector=page.locator('.desk-inspector');
 await inspector.getByRole('button',{name:'Layout',exact:true}).click();await inspector.getByLabel('Card width',{exact:true}).fill('12');await inspector.getByRole('button',{name:'Display',exact:true}).click();await inspector.getByLabel('Card title',{exact:true}).fill('My observations');
 await inspector.getByRole('button',{name:'Content',exact:true}).click();await inspector.getByLabel('Tag',{exact:true}).fill('growth');const card=page.locator('.desk-card').filter({has:page.getByRole('heading',{name:'My observations',exact:true})});await expect(card).toContainText('Watching a seed unfold');await expect(card).not.toContainText('Does paper');await inspector.getByRole('button',{name:'Close card settings',exact:true}).click();
 await expect.poll(async()=>{const response=await sessionRequest(page,'get',app.origin+'/api/dashboard');return (await response.json()).settings.views[0].panels[0].config.title;}).toBe('My observations');await page.reload();await expect(card).toContainText('Watching a seed unfold');expect((await fixture.workspace.read()).book.entries).toEqual(before);expect(errors).toEqual([]);
});
