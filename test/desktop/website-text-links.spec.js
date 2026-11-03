import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {desktopFixture} from './fixture.js';
import {createWebsiteWorkspace} from './website-workspace-fixture.js';
import english from '../../src/web/locales/en/websiteFiles.json' with {type:'json'};

const fieldURL='https://example.org/methods/salinity';
const taxonomyURL='https://example.org/field-guide/algae';
const sample=`<!doctype html><html lang="en"><head><title>Intertidal field guide</title></head>
 <body><main><h1>Intertidal field guide</h1><p id="method"><em>Calibration</em> reference</p>
 <section id="station" style="padding:1.3rem;border:1px solid gray"><h2>Sampling station</h2>
 <table><caption>Specimen identification</caption><tbody><tr><th scope="row">Marine algae</th>
 <td><strong>Taxonomy</strong> reference</td></tr></tbody></table></section></main></body></html>`;

async function selectLine(page,node){
 await node.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
}
test('authors external links in page prose and a reusable table cell, then publishes their formatted labels',async({browser},info)=>{
 test.skip(process.env.OBSERVANDA_QUALIFY_SOURCE_WEBSITE!=='1'||Boolean(process.env.OBSERVANDA_DESKTOP_EXECUTABLE),'Requires explicit source Electron qualification.');
 test.setTimeout(180000);
 const fixture=await desktopFixture('observanda-text-links-');let app,visitor,failure;
 const images=new Map();
 async function capture(name,locator){
  if(process.env.OBSERVANDA_LINK_PROOF==='1')images.set(name,await locator.screenshot());
 }
 try{
  app=await fixture.start();expect(await app.evaluate(({app})=>app.isPackaged)).toBe(false);
  const page=await app.firstWindow();await page.setViewportSize({width:1440,height:950});
  await createWebsiteWorkspace(page,fixture.directory,'Tidal laboratory');
  const id=await page.evaluate(async html=>{
   const {contextId}=await(await fetch('/api/storage')).json();
   const result=await fetch('/api/website-files/create',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':contextId},body:JSON.stringify({name:'Intertidal field guide',html,css:'main{max-width:45rem;padding:1.5rem;font:17px/1.5 system-ui;color:#14413e}th,td{padding:.35rem .7rem;text-align:left}'})});
   if(!result.ok)throw Error('Could not create sample website: '+result.status);
   return (await result.json()).site.id;
  },sample);
  await expect.poll(()=>page.evaluate(async()=>{
   const response=await fetch('/api/website-files/preparation');return response.ok?(await response.json()).preparation.state:response.status;
  }),{timeout:30000}).toBe('ready');
  await page.goto(new URL('/#/websites/'+id+'/editor',page.url()).href);
  const canvas=page.frameLocator('#website-files-canvas'),panel=page.locator('.website-rich-link-dialog[open]');
  const href=panel.getByRole('textbox',{name:english.richLinkAddress,exact:true});
  const label=panel.getByRole('textbox',{name:english.richLinkFor,exact:true});
  const apply=panel.getByRole('button',{name:english.richApplyLink});
  const guide=canvas.locator('#method');
  await selectLine(page,guide);
  await page.getByRole('button',{name:english.richLink,exact:true}).click();
  await expect(label).toHaveValue('Calibration reference');
  await href.fill('https://example.org/first-draft');await apply.click();
  await expect(guide.locator('a')).toHaveText('Calibration reference');
  await guide.locator('a').dblclick();await page.keyboard.press('Control+k');
  await expect(href).toHaveValue('https://example.org/first-draft');
  await href.fill(fieldURL);await capture('page-link-address',panel);await href.press('Enter');
  await expect(guide.locator('a')).toHaveAttribute('href',fieldURL);await expect(guide.locator('em')).toHaveText('Calibration');
  await guide.locator('a').dblclick();await page.getByRole('button',{name:english.richUnlink,exact:true}).click();
  await expect(guide.locator('a')).toHaveCount(0);await expect(guide.locator('em')).toHaveText('Calibration');
  await selectLine(page,guide);await page.keyboard.press('Control+k');await href.fill(fieldURL);await apply.click();
  await page.getByRole('button',{name:english.save,exact:true}).click();

  const library=page.locator('[data-website-components]');
  await page.getByRole('button',{name:english.componentLibrary,exact:true}).click();
  await canvas.locator('#station').click({position:{x:8,y:8}});
  await library.getByLabel(english.componentName,{exact:true}).fill('Specimen panel');
  await library.getByRole('button',{name:english.componentCreate}).click();
  await expect(canvas.locator('[data-website-instance]')).toHaveCount(1);
  await library.getByRole('button',{name:english.componentEdit}).click();
  const editor=page.getByRole('dialog',{name:english.componentEdit,exact:true});
  const main=editor.frameLocator('[data-main-canvas]'),cell=main.getByRole('cell',{name:'Taxonomy reference'});
  await selectLine(page,cell);await page.keyboard.press('Control+k');
  await expect(label).toHaveValue('Taxonomy reference');await href.fill('javascript:alert(1)');await apply.click();
  await expect(panel).toBeVisible();await expect(cell.locator('a')).toHaveCount(0);
  await href.fill(taxonomyURL);await capture('component-link-address',panel);await apply.click();
  await expect(cell.locator('a')).toHaveAttribute('href',taxonomyURL);
  await cell.locator('a').dblclick();await editor.getByRole('button',{name:english.richLink,exact:true}).click();
  await expect(href).toHaveValue(taxonomyURL);await panel.getByRole('button',{name:english.cancel}).click();
  await editor.getByRole('button',{name:english.componentApply}).click();await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(canvas.locator('#method a')).toHaveAttribute('href',fieldURL);
  await expect(canvas.locator('[data-website-instance] td a')).toHaveAttribute('href',taxonomyURL);
  const output=path.join(fixture.directory,'edition');await mkdir(output);
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();
  await page.getByLabel('Destination folder',{exact:true}).fill(output);await page.getByRole('button',{name:'Review file changes'}).click();
  await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files'}).click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();

  visitor=await browser.newContext({javaScriptEnabled:false});
  await visitor.route(/^https?:/i,route=>route.abort());
  const published=await visitor.newPage();await published.goto(pathToFileURL(path.join(output,'index.html')).href);
  for(const [name,address,mark,text] of [['Calibration reference',fieldURL,'em','Calibration'],['Taxonomy reference',taxonomyURL,'strong','Taxonomy']]){
   const anchor=published.getByRole('link',{name,exact:true});await expect(anchor).toHaveAttribute('href',address);
   await expect(anchor.locator(mark)).toHaveText(text);
  }
  await capture('published-text-links',published.locator('main'));
 }catch(error){failure=error;throw error;}
 finally{
  await visitor?.close();
  try{await fixture.dispose(app);}catch(error){if(!failure)throw error;console.error('Desktop cleanup:',error.message);}
 }
 for(const [name,png] of images)await writeFile(info.outputPath(name+'.png'),png,{flag:'wx'});
});
