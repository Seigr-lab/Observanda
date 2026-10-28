import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {buildBrowser} from '../../scripts/browser-build.js';
import {createApplicationAssets} from '../../src/application-assets.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {RecordWriting} from '../../src/record-writing.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

for(const compiled of [false,true])test('saved formatting survives reader, editing and reload '+(compiled?'with compiled assets':'with source assets'),async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-formatting-ui-')),book=sampleNotebook(),record=book.entries[0],id=randomUUID(),equationId=randomUUID();
 const body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Formatted observation',marks:[{type:'text_color',attrs:{color:'#123456'}},{type:'highlight',attrs:{color:'#fedcba'}},{type:'font_family',attrs:{font:'editorial'}}]}]},{type:'book_equation',attrs:{version:1,id:equationId,source:'E = m c^2',label:'Synthetic energy equation'}}]};
 record.sections=[{id,title:'Selected observation',body}];
 let fixture,app;const errors=[],violations=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy/.test(message.text()))violations.push(message.text());});
 try{
  let browserAssets;if(compiled){const out=path.join(directory,'frontend');await buildBrowser({out});browserAssets=await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});}
  fixture=await encryptedFixture(directory,book);app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets});
  let equationRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/vendor/equations.js')equationRequests++;});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();expect(equationRequests).toBe(0);
  if(!compiled)await page.route('**/vendor/equations.js',route=>route.abort(),{times:1});
  await page.goto(app.origin+'/#/records/'+record.id+'/read/'+id);
  const section=page.locator('#record-section-'+id),formatted=section.locator('.rt-font-editorial');
  const check=async root=>{await expect(root.locator('.rt-color-123456')).toHaveCSS('color','rgb(18, 52, 86)');await expect(root.locator('.rt-highlight-fedcba')).toHaveCSS('background-color','rgb(254, 220, 186)');await expect(root.locator('.rt-font-editorial')).toHaveCSS('font-family',/Georgia/);};
  await expect(formatted).toHaveText('Formatted observation');await check(section);
  const equation=section.locator('#record-equation-'+equationId);
  if(!compiled){await expect(equation).toContainText('E = m c^2');await equation.getByRole('button',{name:'Retry equation rendering',exact:true}).click();}
  await expect(equation.locator('math')).toHaveCount(1);
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await section.getByRole('button',{name:'Edit section',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit writing section',exact:true});await expect(dialog.locator('.ProseMirror')).toBeVisible();await check(dialog);
  await dialog.getByLabel('Section heading',{exact:true}).fill('Saved formatted observation');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.reload();await expect(section).toContainText('Saved formatted observation');await check(section);await expect(equation.locator('math')).toHaveCount(1);
  const saved=await new RecordWriting(fixture.workspace).read({workspaceId:book.id,recordId:record.id,sectionId:id});expect(saved.value.body).toEqual(body);
  expect(errors).toEqual([]);expect(violations).toEqual([]);
 }finally{
  await app?.close();if(fixture)clearVault(fixture.vault);
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-formatting-ui-'))throw Error('Unexpected disposable folder');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
