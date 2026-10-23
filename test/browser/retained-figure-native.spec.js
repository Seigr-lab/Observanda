import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {RecordValues} from '../../src/record-values.js';
import {createFigure} from '../../src/web/figure-model.js';
import {validRetainedFigure} from '../../src/web/retained-figure-model.js';
import {validFigureSource} from '../../src/web/figure-provenance.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';

test('saved retained figure edits recover from the normal record draft and keep measurements unchanged',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-editor-')),book=sampleNotebook();book.entries=book.entries.slice(0,1);const record=book.entries[0];record.figures=[];const fixture=await encryptedFixture(directory,book),{workspace,vault}=fixture,materials=new ResearchMaterials(workspace),values=new RecordValues(workspace),figure=createFigure();figure.title='Acquired observations';figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:4,error:1}];
 const descriptor=await workspace.withLock(()=>new RetainedFigureDocuments(workspace).retain(figure)),source=await workspace.withLock(()=>materials.commit({kind:'analysis',recordId:record.id,title:figure.title,content:{inputs:[],outputs:[],tool:'Retained acquisition',version:'1',parameters:'Synthetic readings',figure:descriptor}})),target={workspaceId:book.id,recordId:record.id,field:'figure:'+figure.id},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:{...descriptor,source}}});
 const app=await testServer({root:workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.getByRole('dialog',{name:'Edit Figure',exact:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Open retained figure',exact:true}).click();await expect(page.locator('#dialog [data-rf-range]')).toHaveText('1-2 of 2');await page.locator('#dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await page.getByRole('button',{name:'Edit figure Acquired observations',exact:true}).click();await expect(dialog.locator('[data-fe-value]')).toHaveValue('Acquired observations');
  const changedResponse=page.waitForResponse(response=>response.url().endsWith('/retained-figure-change'));await dialog.locator('[data-fe-value]').fill('Documented observations');const response=await changedResponse,wire=await response.text(),changeReply=response.headers()['content-type'].includes('ndjson')?wire.trim().split('\n').map(line=>JSON.parse(line)).findLast(item=>item.result)?.result:JSON.parse(wire);expect(validFigureSource(changeReply?.ref),'saved figure source reference: '+JSON.stringify(changeReply?.ref)).toBeTruthy();expect(validRetainedFigure(changeReply?.figure),'saved figure descriptor: '+JSON.stringify(changeReply?.figure)).toBeTruthy();expect(changeReply.figure.document.data).toEqual(descriptor.document.data);await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(dialog.locator('[data-fe-value]')).toHaveValue('Documented observations');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=(await values.read(target)).value.value;expect(saved.document.data).toEqual(descriptor.document.data);expect(saved.title).toBe('Documented observations');expect(saved.source).not.toEqual(source);expect((await materials.read(source)).content.figure.title).toBe('Acquired observations');
  await page.getByRole('button',{name:'Edit figure Documented observations',exact:true}).click();await expect(dialog.locator('[data-fe-value]')).toHaveValue('Documented observations');await dialog.locator('[data-fe-part]').selectOption('series');await dialog.locator('[data-fe-property]').selectOption('style.visible');await dialog.locator('[data-fe-value][type=checkbox]').uncheck();await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const hidden=(await values.read(target)).value.value,reader=await new RetainedFigureDocuments(workspace).open(hidden);expect((await reader.window({collection:'series',plotId:figure.id,offset:0,limit:1})).items[0].value.style.visible).toBe(false);expect((await reader.window({collection:'points',plotId:figure.id,seriesId:figure.series[0].id,offset:0,limit:2})).items.map(row=>row.value)).toEqual(figure.series[0].points);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
