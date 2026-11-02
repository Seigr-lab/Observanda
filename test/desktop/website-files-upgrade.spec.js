import {test,expect} from '@playwright/test';
import {mkdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {websiteDesktopFixture} from './installed-website-app.js';
import {createPreviousWebsites,previousDefaultText,previousHomeText,previousSiteName,previousWorkspaceName} from './previous-website-fixture.js';
import {disableWebsiteResearch} from './website-workspace-fixture.js';

const offlineEdit='Edited in the upgraded site while all research databases were unavailable.';

async function chooseSite(page,siteId){
 const selector=page.locator('select[data-website-file-site]');
 await expect(selector.locator('option').filter({hasText:previousSiteName})).toHaveCount(1,{timeout:60000});
 if(await selector.inputValue()!==siteId)await selector.selectOption(siteId);
 await expect(page.frameLocator('#website-files-canvas').locator('body')).toContainText(previousHomeText);
}

test('upgrade opens previously saved default and named websites and publishes their saved files offline',async()=>{
 const previous=process.env.OBSERVANDA_DESKTOP_PREVIOUS_EXECUTABLE;
 test.skip(!previous||!process.env.OBSERVANDA_DESKTOP_EXECUTABLE&&process.env.OBSERVANDA_QUALIFY_SOURCE_WEBSITE!=='1','Requires the alpha.21 predecessor and a packaged candidate or explicitly selected source Electron.');
 test.setTimeout(360000);
 const fixture=await websiteDesktopFixture(),output=path.join(fixture.directory,'published');
 const errors=[],onlineRoutes=[],offlineRoutes=[];
 let app=null,page=null,phase='save original websites';
 function watch(page,routes){
  page.on('request',request=>{const route=new URL(request.url()).pathname;if(route.startsWith('/api/'))routes.push(route);});
  page.on('pageerror',error=>errors.push(error.message));
 }
 try{
  const {siteId,roots}=await createPreviousWebsites(fixture,previous);
  phase='open existing workspace normally';app=await fixture.start();page=await app.firstWindow();watch(page,onlineRoutes);
  await expect(page.locator('.topbar .workspace-name')).toHaveText(previousWorkspaceName,{timeout:60000});
  const started=performance.now(),head=path.join(roots[0],'.observanda','website-files','sites',siteId,'head.json');
  // Observe the committed file without invoking a preparation or editor API.
  await expect.poll(async()=>{
   try{return (await stat(head)).isFile();}catch(error){if(error.code==='ENOENT')return false;throw error;}
  },{timeout:120000,message:'Opening the workspace must prepare the existing saved site'}).toBe(true);
  const upgradedMs=Math.round(performance.now()-started);
  phase='open original default and named work';await page.locator('#main-navigation').getByRole('button',{name:'Website editor',exact:true}).click();
  await expect(page.frameLocator('#website-files-canvas').locator('body')).toContainText(previousDefaultText,{timeout:60000});
  await chooseSite(page,siteId);
  const sites=page.locator('select[data-website-file-site]');
  const other=await sites.locator('option').evaluateAll((options,id)=>options.map(option=>option.value).filter(value=>value&&value!==id),siteId);
  expect(other).toHaveLength(1);
  await sites.selectOption(other[0]);await expect(page.frameLocator('#website-files-canvas').locator('body')).toContainText(previousDefaultText);
  await chooseSite(page,siteId);
  expect(onlineRoutes.filter(route=>/\/(convert-existing|legacy-list)$/.test(route))).toEqual([]);
  phase='stop before taking databases offline';await fixture.close(app);app=null;
  const databases=await disableWebsiteResearch(fixture.directory,roots);expect(databases).toHaveLength(3);
  phase='open saved files with research unavailable';app=await fixture.start(undefined,{website:true});page=await app.firstWindow();watch(page,offlineRoutes);
  await chooseSite(page,siteId);
  // Cold-start requests may finish before Electron exposes its first window.
  // Capture them before the later reload resets this performance timeline.
  offlineRoutes.push(...await page.evaluate(()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname).filter(route=>route.startsWith('/api/'))));
  const pages=page.locator('select[data-website-file-page]');
  const record=pages.locator('option').filter({hasText:'Retained observation'});
  await expect(record).toHaveCount(1);const entryPath=await record.getAttribute('value');await pages.selectOption(entryPath);
  const canvas=page.frameLocator('#website-files-canvas');
  await expect(canvas.locator('body')).toContainText('Permitted record body');
  await expect(canvas.locator('body')).toContainText('withdraw-this-result');
  await expect(canvas.locator('body')).not.toContainText('never-export-this-canary');
  const methods=pages.locator('option').filter({hasText:'Methods'});await expect(methods).toHaveCount(1);
  await pages.selectOption(await methods.getAttribute('value'));await expect(canvas.locator('body')).toContainText('Authored methods page from the previous editor.');
  await pages.selectOption('index.html');await expect(canvas.locator('body')).toContainText(previousHomeText);
  phase='edit and save previous site';await page.getByRole('button',{name:'Add paragraph',exact:true}).click();
  const paragraph=canvas.locator('main > p').last();await paragraph.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.type(offlineEdit);
  await expect(paragraph).toHaveText(offlineEdit);
  await page.getByRole('button',{name:'CSS',exact:true}).click();
  const css=page.getByRole('textbox',{name:'CSS',exact:true});await css.fill(await css.inputValue()+'\nmain > p { color: rgb(31, 57, 83); }');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.reload();await chooseSite(page,siteId);await expect(canvas.getByText(offlineEdit,{exact:true})).toBeVisible();
  phase='preview saved HTML and publish to folder';await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const preview=page.frameLocator('.website-files-canvas');await expect(preview.getByText(offlineEdit,{exact:true})).toHaveCSS('color','rgb(31, 57, 83)');
  const url=await page.locator('iframe.website-files-canvas').getAttribute('src');
  const expected=await page.evaluate(async url=>{const response=await fetch(url);if(!response.ok)throw Error('Preview file unavailable');return response.text();},url);
  await mkdir(output);await page.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(output);
  await page.getByRole('button',{name:'Review file changes',exact:true}).click();await page.locator('[data-website-file-folder-confirm]').check();
  await page.getByRole('button',{name:'Write reviewed files',exact:true}).click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
  expect(await readFile(path.join(output,'index.html'),'utf8')).toBe(expected);
  const entry=await readFile(path.join(output,entryPath),'utf8');expect(entry).toContain('Permitted record body');expect(entry).not.toMatch(/never-export-this-canary|Private appendix/);
  expect(await readFile(path.join(output,'styles.css'),'utf8')).toContain('rgb(31, 57, 83)');
  offlineRoutes.push(...await page.evaluate(()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname).filter(route=>route.startsWith('/api/'))));
  const allowed=route=>route.startsWith('/api/website-files/')||['/api/session','/api/access/status','/api/language','/api/interface'].includes(route);
  expect([...new Set(offlineRoutes.filter(route=>!allowed(route)))]).toEqual([]);expect(errors).toEqual([]);
  for(const file of databases)expect((await stat(file)).isFile()).toBe(true);
  console.log(JSON.stringify({predecessor:'alpha.21',packagedCandidate:Boolean(fixture.packaged),automaticUpgradeMs:upgradedMs,previousSites:2,databasesUnavailable:databases.length,publishedMatchesPreview:true}));
 }catch(error){
  const screen=await page?.locator('body').innerText({timeout:2000}).catch(()=>'');
  const state=await page?.evaluate(async()=>{
   const response=await fetch('/api/website-files/preparation',{signal:AbortSignal.timeout(2000)});
   return response.ok?(await response.json()).preparation:{status:response.status};
  }).catch(()=>null);
  console.error('Website upgrade qualification failed during '+phase+'\n'+JSON.stringify(state)+'\n'+(screen??'').slice(0,1400));throw error;
 }finally{await fixture.dispose(app);}
});
