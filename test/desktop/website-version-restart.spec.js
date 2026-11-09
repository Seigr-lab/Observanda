import {test,expect} from '@playwright/test';
import path from 'node:path';
import {desktopFixture} from './fixture.js';
import {createWebsiteWorkspace,disableWebsiteResearch} from './website-workspace-fixture.js';

test('a named design survives desktop shutdown and an offline restore survives a second shutdown',async()=>{
 test.setTimeout(180000);
 const fixture=await desktopFixture('observanda-design-restart-');
 const workspace='Design workshop',title='Seasonal atlas';
 let app,page;
 const button=name=>page.getByRole('button',{name,exact:true});
 const canvas=()=>page.frameLocator('#website-files-canvas').locator('h1');
 async function start(website){
  app=await fixture.start(undefined,{website});page=await app.firstWindow();
  return app.process().pid;
 }
 async function restart(previous){
  await fixture.close(app);app=null;
  expect(await start(true)).not.toBe(previous);
 }
 async function saveHeading(value){
  await button('HTML').click();
  const html=page.getByRole('textbox',{name:'HTML',exact:true});
  const content=await html.inputValue();
  expect(content).toMatch(/<h1\b[^>]*>[^<]*<\/h1>/);
  await html.fill(content.replace(/(<h1\b[^>]*>)[^<]*(<\/h1>)/,(_match,open,close)=>open+value+close));
  await button('Save website').click();
  await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await button('Visual editor').click();await expect(canvas()).toHaveText(value);
 }
 try{
  await start(false);
  await createWebsiteWorkspace(page,fixture.directory,workspace);
  await fixture.close(app);app=null;
  const first=await start(true);
  await button('New website').click();await page.getByLabel('Website name',{exact:true}).fill(title);
  await page.locator('form[data-website-files-form]').getByRole('button',{name:'New website',exact:true}).click();
  await expect(canvas()).toHaveText(title);
  await saveHeading('Autumn transect');
  await button('Version history').click();await page.getByLabel('Checkpoint name').fill('Field review');
  await button('Name current checkpoint').click();
  await expect(page.locator('[data-versions=version] option:checked')).toContainText('Field review');
  await button('Return to editing').click();
  await saveHeading('Winter transect');
  await fixture.close(app);app=null;
  await disableWebsiteResearch(fixture.directory,[path.join(fixture.directory,workspace)]);
  const second=await start(true);expect(second).not.toBe(first);
  await expect(canvas()).toHaveText('Winter transect',{timeout:60000});
  await button('Version history').click();
  const selected=page.locator('[data-versions=version]'),revision=selected.locator('option').filter({hasText:'Field review'});
  await selected.selectOption(await revision.getAttribute('value'));await button('Compare changes').click();
  await expect(page.locator('.website-version-diff pre').first()).toContainText('Autumn transect');
  await expect(page.locator('.website-version-diff pre').last()).toContainText('Winter transect');
  await button('Restore as new version').click();await expect(canvas()).toHaveText('Autumn transect');
  await restart(second);await expect(canvas()).toHaveText('Autumn transect',{timeout:60000});
  await button('Preview saved website').click();
  await expect(page.frameLocator('#website-files-preview').locator('h1')).toHaveText('Autumn transect');
 }catch(error){
  if(page&&!page.isClosed())error.message+='\nVisible editor: '+(await page.locator('body').innerText()).slice(0,800);
  throw error;
 }finally{await fixture.dispose(app);}
});
