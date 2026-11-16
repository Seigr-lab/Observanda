import {sessionRequest} from './session-fixture.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../../src/server.js';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {navigate,preferences} from './preferences-helper.js';
let app,directory,fixture;
const noInnerScroll=async locator=>{
 await expect.poll(()=>locator.evaluate(el=>{
   const d=el.contentDocument;return d?.querySelector('main')?Math.max(0,d.documentElement.scrollHeight-el.contentWindow.innerHeight):999;
 })).toBeLessThanOrEqual(1);
};
const noPanels=async page=>expect(await page.evaluate(()=>[...document.querySelectorAll('.dashboard-panel,.dashboard-panel>div,#main-navigation,.workspace-tree')].filter(el=>el.getClientRects().length&&el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className))).toEqual([]);
test.beforeEach(async({page})=>{
 directory=await mkdtemp(path.join(os.tmpdir(),'observanda-scroll-'));const book=sampleNotebook();
 book.title='Field studies';book.website.home.sections=[{id:randomUUID(),kind:'text',title:'Notes from the river',show:true,body:Array.from({length:9},(_,i)=>`Observation ${i+1}. The river changed after the rain. We recorded water levels, photographed the bank and compared notes from the same location.`).join('\n\n')},{id:randomUUID(),kind:'text',title:'Follow-up work',show:true,body:'Return after the next rainfall and compare the measurements.'}];
 book.entries=Array.from({length:12},(_,i)=>({...book.entries[0],id:randomUUID(),title:`River observation ${i+1}`,body:'A record of conditions along the river bank.',figures:[]}));
 fixture=await encryptedFixture(directory,book);app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});await page.goto(app.url);
});
test.afterEach(async()=>{await app?.close();app=null;if(fixture)await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('dashboard cards show their selected page and the website design preview shows the whole page',async({page})=>{
 await navigate(page,'Dashboard');await page.getByRole('button',{name:'Settings for Recent records',exact:true}).click();const panel=page.locator('.desk-inspector');await panel.getByLabel('Items per page',{exact:true}).fill('12');await expect(panel.getByLabel('Items per page',{exact:true})).toHaveValue('12');await expect.poll(async()=>{const result=await sessionRequest(page,'get',app.origin+'/api/dashboard');return (await result.json()).settings.views[0].panels[0].count;}).toBe(12);await panel.getByRole('button',{name:'Close card settings',exact:true}).click();
 const recent=page.locator('.desk-card').filter({has:page.getByRole('heading',{name:'Recent records',exact:true})});await expect(recent.locator('.desk-item')).toHaveCount(12);await noPanels(page);await recent.getByRole('button',{name:/River observation 12/}).scrollIntoViewIfNeeded();
 await preferences(page,'Website design');await noInnerScroll(page.locator('#design-preview'));await noPanels(page);
});
