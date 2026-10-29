import {test,expect} from '@playwright/test';
import guide from '../../src/web/locales/en/guide.json' with {type:'json'};
import caWorkspace from '../../src/web/locales/ca/workspaceViews.json' with {type:'json'};
import nbWorkspace from '../../src/web/locales/nb/workspaceViews.json' with {type:'json'};
import nnWorkspace from '../../src/web/locales/nn/workspaceViews.json' with {type:'json'};
import esWorkspace from '../../src/web/locales/es/workspaceViews.json' with {type:'json'};
import caGuide from '../../src/web/locales/ca/guide.json' with {type:'json'};
import nbGuide from '../../src/web/locales/nb/guide.json' with {type:'json'};
import nnGuide from '../../src/web/locales/nn/guide.json' with {type:'json'};
import {pathToFileURL} from 'node:url';
import {buildBrowser} from '../../scripts/browser-build.js';
import {createApplicationAssets} from '../../src/application-assets.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
async function fixture({compiled=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-help-ui-')),book=upgradeNotebook({...sampleNotebook(),title:'workspace'}),f=await encryptedFixture(directory,book),preferencesFile=path.join(directory,'preferences.json');
 let browserAssets;if(compiled){const out=path.join(directory,'frontend');await buildBrowser({out});browserAssets=await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});}
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile,browserAssets});
 return {...f,book:(await f.workspace.read()).book,app,close:async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
test('Help searches the bundled manual, follows stable anchors, changes language and retains it after reload',async({page},testInfo)=>{
 const f=await fixture({compiled:true}),errors=[],reads=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/notebook'))reads.push(r.url());});
 try{
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/preferences/help');
  await expect(page.getByRole('heading',{name:'Help',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Observanda on GitHub',exact:true})).toHaveAttribute('href','https://github.com/Seigr-lab/Observanda');
  await page.getByRole('searchbox',{name:'Search documentation'}).fill('nondecimal');
  await expect(page.locator('.help-results li')).toHaveCount(1);await expect(page.locator('.help-results')).toContainText('nondecimal');
  await page.locator('.help-results a').focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/preferences\/help\/evidence\/analysis$/);await expect(page.locator('#help-evidence-analysis')).toBeFocused();
  await page.getByRole('link',{name:'Read the entire guide',exact:true}).click();await expect(page.locator('.help-article')).toHaveCount(guide.topics.length);expect(await page.locator('.help-article>h2').evaluateAll(items=>items.map(el=>el.id))).toEqual(guide.topics.map(topic=>'help-'+topic.id));
  await page.locator('[data-language-choice]').selectOption('ca');
  await expect(page.getByRole('heading',{name:'Preferències',exact:true})).toBeVisible();await expect(page.locator('.help-article:has(#help-getting-started)')).toContainText(caGuide.topics.find(topic=>topic.id==='getting-started').title);
  await page.locator('[data-language-choice]').selectOption('nn');await expect(page.locator('.help-article:has(#help-getting-started)')).toContainText(nnGuide.topics.find(topic=>topic.id==='getting-started').title);
  await page.reload();await expect(page.locator('[data-language-choice]')).toHaveValue('nn');await expect(page.getByRole('heading',{name:'Innstillingar',exact:true})).toBeVisible();
  await page.locator('[data-language-choice]').selectOption('nb');await expect(page.locator('.help-article:has(#help-getting-started)')).toContainText(nbGuide.topics.find(topic=>topic.id==='getting-started').title);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  expect(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.locator('.help-navigation')).toHaveCSS('display','flex');
  const links=await page.locator('.help-navigation a').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  expect(links[1].left>=links[0].right+10||links[1].top>=links[0].bottom+10).toBe(true);
  await page.screenshot({path:testInfo.outputPath('help-narrow.png')});
  expect(reads).toEqual([]);expect(errors).toEqual([]);
  expect((await f.workspace.read()).book).toEqual(f.book);
 }finally{await f.close();}
});
test('language and documentation failures can be retried without accepting a broken language choice',async({page})=>{
 const f=await fixture();try{
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/preferences/help');
  await expect(page.getByRole('link',{name:'Records, methods and runs',exact:true})).toBeVisible();
  await page.route('**/locales/es/navigation.json',route=>route.fulfill({status:503,body:'Unavailable'}));
  await page.locator('[data-language-choice]').selectOption('es');
  await expect(page.locator('.language-preference [role=alert]')).toContainText('previous choice is unchanged');
  await expect(page.locator('[data-language-choice]')).toHaveValue('en');
  await page.unroute('**/locales/es/navigation.json');
  await page.route('**/locales/es/guide.json',route=>route.fulfill({status:503,body:'Unavailable'}));
  await page.locator('[data-language-choice]').selectOption('es');await expect(page.locator('.help-view [role=alert]')).toContainText('No se ha podido');
  await page.unroute('**/locales/es/guide.json');await page.getByRole('button',{name:'Reintentar',exact:true}).click();
  await expect(page.getByRole('link',{name:'Registros, métodos y ejecuciones',exact:true})).toBeVisible();
 }finally{await f.close();}
});


test('Preferences exposes Help and language changes preserve unsaved workspace details and live navigation',async({page})=>{
 const f=await fixture();try{
  await page.goto(f.app.url);
  await page.locator('#main-navigation [data-action="preferences"]').click();
  await expect(page.locator('.preferences-tabs [data-action="help"]')).toBeVisible();
  await expect(page.getByRole('link',{name:'Observanda on GitHub',exact:true})).toHaveAttribute('href','https://github.com/Seigr-lab/Observanda');
  const name=page.getByLabel('Workspace name',{exact:true});await name.fill('Unfinished private workspace name');
  await page.locator('[data-language-choice]').selectOption('es');await expect(page.locator('#leave-dialog')).toBeVisible();
  await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();
  await expect(name).toHaveValue('Unfinished private workspace name');await expect(page.locator('[data-language-choice]')).toHaveValue('en');
  await page.locator('[data-action="workspace-discard"]').click();
  await page.locator('.preferences-tabs [data-action="help"]').click();await expect(page.getByRole('searchbox',{name:'Search documentation'})).toBeVisible();
  await page.evaluate(()=>{window.savedTree=document.querySelector('.workspace-tree');window.savedProject=document.querySelector('.tree-project');if(window.savedProject)window.savedProject.open=true;});
  await page.locator('[data-language-choice]').selectOption('ca');
  await expect(page.locator('#main-navigation [data-action="preferences"]')).toHaveText('Preferències');
  expect(await page.evaluate(()=>savedTree===document.querySelector('.workspace-tree')&&(!savedProject||savedProject.isConnected&&savedProject.open))).toBe(true);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#preferences-section').selectOption('preferences');await expect(page.getByLabel(caWorkspace.name,{exact:true})).toHaveValue(f.book.title);
  await page.locator('#preferences-section').selectOption('help');await expect(page.getByRole('heading',{name:'Ajuda',exact:true})).toBeVisible();
 }finally{await f.close();}
});
test('a missing saved language falls back to English without breaking application startup',async({page})=>{
 const f=await fixture();try{
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/preferences/help');
  await page.locator('[data-language-choice]').selectOption('nn');await expect(page.locator('.preferences-heading')).toContainText('Innstillingar');
  await page.route('**/locales/nn/navigation.json',route=>route.fulfill({status:503,body:'Unavailable'}));await page.reload();
  await expect(page.locator('.language-preference [role=alert]')).toContainText('English is being used');
  await expect(page.getByRole('searchbox',{name:'Search documentation'})).toBeVisible();
  await page.unroute('**/locales/nn/navigation.json');await page.locator('[data-language-choice]').selectOption('nn');
  await expect(page.locator('.preferences-heading')).toContainText('Innstillingar');
 }finally{await f.close();}
});

test('workspace forms translate in every supported language without changing saved values or form commands',async({page})=>{
 const f=await fixture(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/preferences');
  for(const [language,messages] of Object.entries({nb:nbWorkspace,nn:nnWorkspace,ca:caWorkspace,es:esWorkspace})){
   await page.locator('[data-language-choice]').selectOption(language);
   const form=page.locator('#workspace-name-form');
   await expect(form.getByLabel(messages.name,{exact:true})).toHaveValue(f.book.title);
   await expect(form.getByLabel(messages.introduction,{exact:true})).toHaveValue(f.book.description);
   await expect(form.getByRole('button',{name:messages.save,exact:true})).toBeDisabled();
   if(!await page.locator('.workspace-reference').evaluate(element=>element.open))await page.locator('.workspace-reference summary').click();
   await page.locator('[data-action="workspace-reorganize"]').click();
   await expect(page.locator('#workspace-organize-form input[name="copyLogos"]')).toHaveCount(1);
   await expect(page.locator('#workspace-organize-form').getByRole('button',{name:messages.review,exact:true})).toBeVisible();
   await page.locator('#dialog').getByRole('button',{name:messages.cancel,exact:true}).click();
  }
  expect(errors).toEqual([]);expect((await f.workspace.read()).book).toEqual(f.book);
 }finally{await f.close();}
});
