import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {largeCategory} from '../module-capacity-fixture.js';
import {workspaceModules} from '../../src/modules/index.js';
import {ModuleCatalogue} from '../../src/modules/catalogue.js';
import {ModuleReader} from '../../src/modules/reader.js';

for(const nearLimit of [false,true])test((nearLimit?'Boundary':'Large')+' resource schema has bounded fields and choices, recovers edits and keeps hidden values',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-schema-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),data=largeCategory({nearLimit}),id=randomUUID();
 data.fields[24].required=true;
 const settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules=['resources'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const modules=workspaceModules(f.workspace);await modules.execute({workspaceId:book.id,commandId:randomUUID(),action:'category.save',payload:{id,expectedRevision:null,data}},{compact:true});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[],sizes=[];
 const original=ModuleCatalogue.prototype.read;ModuleCatalogue.prototype.read=()=>{throw Error('Full module state loaded');};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/modules/drafts/transfer/'))sizes.push(Buffer.byteLength(r.postData()??''));});
 try{
  await page.request.post(app.origin+'/api/session',{data:{token:app.launchToken},headers:{Origin:app.origin}});
  await page.goto(app.origin+'/#/modules/resources/category/'+id);const main=page.locator('main');
  await expect(main.getByLabel('Category name',{exact:true})).toHaveValue(data.name);
  await expect(main.getByLabel('Field label',{exact:true})).toHaveCount(10);
  await expect(main.locator('[data-schema-choice]')).toHaveCount(20);
  let loseAcknowledgements=true;
  await page.route('**/api/modules/drafts/transfer/*',async route=>{
   const response=await route.fetch({timeout:60000}),reply=await response.json();
   if(loseAcknowledgements&&response.ok()&&reply.etag)return route.fulfill({status:503,json:{message:'Lost large checkpoint reply'}});
   await route.fulfill({response});
  });
  const fields=main.getByRole('navigation',{name:'Field pages',exact:true});await fields.getByRole('button',{name:'Next',exact:true}).click();
  await expect(main.getByLabel('Field label',{exact:true}).first()).toHaveValue('Field 9');
  await main.getByLabel('Field label',{exact:true}).first().fill('Edited hidden field');
  await main.getByLabel('Find fields',{exact:true}).fill('Part');await expect(main.getByLabel('Field label',{exact:true})).toHaveCount(1);
  await main.getByLabel('Find choices',{exact:true}).fill(String(data.fields[0].choices.length-1).padStart(10,'0'));await expect(main.locator('[data-schema-choice]')).toHaveCount(1);
  await main.locator('[data-schema-choice]').fill('Changed last choice');
  await main.getByRole('button',{name:'Back to categories',exact:true}).click();await expect(main.getByRole('alert')).toContainText('Lost large checkpoint reply',{timeout:60000});
  loseAcknowledgements=false;
  await main.getByRole('button',{name:'Back to categories',exact:true}).click();await expect(main.locator('[data-module-form]')).toHaveCount(0,{timeout:60000});
  await page.reload();await main.locator('[data-recovery-item]').getByRole('button',{name:'Restore draft',exact:true}).click();
  await expect(main.getByLabel('Field label',{exact:true})).toHaveCount(10,{timeout:30000});
  await main.getByRole('button',{name:'Save category',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved',{timeout:60000});
  const saved=(await new ModuleReader(f.workspace).selected({workspaceId:book.id,id})).entity;
  expect(saved.data.fields[10].label).toBe('Edited hidden field');expect(saved.data.fields[0].choices.at(-1)).toBe('Changed last choice');expect(saved.data.fields[24]).toEqual(data.fields[24]);
  if(!nearLimit){
   await main.getByRole('button',{name:'Items',exact:true}).click();await main.getByRole('button',{name:'New item',exact:true}).click();
   await main.getByLabel('Item name',{exact:true}).fill('Part using large schema');await main.getByRole('button',{name:'Choose category',exact:true}).click();
   await page.locator('dialog').getByRole('button',{name:'Select Large category',exact:true}).click();
   await expect(main.getByLabel('Part',{exact:true}).locator('option')).toHaveCount(21);
   await main.getByLabel('Find choices',{exact:true}).fill('Changed last choice');await main.getByLabel('Part',{exact:true}).selectOption('Changed last choice');
   await main.getByLabel('Find choices',{exact:true}).fill('0000000000');await expect(main.getByLabel('Part',{exact:true})).toHaveValue('Changed last choice');
   await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.getByRole('alert')).toContainText('Review Field 23');
   await main.getByLabel('Field 23',{exact:true}).fill('Required value from last page');
   await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.getByRole('heading',{name:'Placement',exact:true})).toBeVisible();
   const reader=new ModuleReader(f.workspace),item=(await reader.list({workspaceId:book.id,type:'resource'})).items[0],resource=(await reader.selected({workspaceId:book.id,id:item.id})).entity;
   expect(resource.data.values).toEqual({part:'Changed last choice',field_23:'Required value from last page'});
  }
  expect(Math.max(...sizes)).toBeLessThan(2*1024*1024);expect(errors).toEqual([]);
 }finally{ModuleCatalogue.prototype.read=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
