import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {copyPlan,copyWorkspace} from '../../src/locations.js';
import {Workspace} from '../../src/storage.js';
import {buildPublication} from '../../src/publication.js';
import {randomUUID} from 'node:crypto';

test('author, annotate, compare, save and restore multi-panel figures through the app',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-panels-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.figures=[1,2].map(n=>{const f=createFigure();f.title='Acquisition '+n;f.x.label='Time (s)';f.y.label='Voltage (V)';f.series[0].points=[{x:0,y:n,error:.1},{x:1,y:n+1,error:.2}];return f;});
 record.results={version:1,statements:[{id:randomUUID(),kind:'figure',figureId:record.figures[0].id,title:'Acquisition interpretation',text:'Two measurements in this acquisition.',limitations:'No claim about other apparatus states.',basis:'authored',source:null}]};
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await page.getByRole('button',{name:'Add multi-panel figure',exact:true}).click();const compound=page.locator('.figure-composition');
  await compound.getByLabel('Multi-panel title',{exact:true}).fill('Linked acquisitions');await compound.getByLabel('Share coordinate range',{exact:true}).check();await compound.getByLabel('Share value range',{exact:true}).check();
  const panel=compound.locator('.figure-workbench'),annotations=panel.locator('.figure-annotations');await annotations.locator('summary').click();await annotations.getByRole('button',{name:'Add interval',exact:true}).click();
  await annotations.getByLabel('Annotation label',{exact:true}).fill('Acquisition window');await annotations.getByLabel('Position / interval start',{exact:true}).fill('0.25');await annotations.getByLabel('Interval end',{exact:true}).fill('0.75');
  await expect(compound.locator(':scope > [data-figure-preview] .figure-interval')).toHaveCount(1);
  await annotations.getByLabel('Annotation labels',{exact:true}).selectOption('key');
  await expect(compound.locator(':scope > [data-figure-preview] .figure-annotation-key-item')).toHaveCount(1);
  await compound.getByLabel('Editing panel',{exact:true}).selectOption({label:'B · Acquisition 2'});await panel.getByLabel('Value 1',{exact:true}).fill('5');await expect(compound.locator(':scope > [data-figure-preview] .figure-panel')).toHaveCount(2);
  await compound.getByRole('button',{name:'Move panel up',exact:true}).click();await expect(compound.getByLabel('Editing panel',{exact:true}).locator('option').first()).toHaveText('B · Acquisition 2');
  const save=page.waitForResponse(r=>r.url().endsWith('/api/research/records/save'));await page.getByRole('button',{name:'Save record',exact:true}).click();expect((await save).ok()).toBe(true);await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id),result=saved.figures.at(-1);expect(result.kind).toBe('panels');expect(result.panels[0].figure.series[0].points[0].y).toBe(5);expect(saved.figures[1].series[0].points[0].y).toBe(2);expect(result.panels[1].figure.annotations[0].end).toBe(.75);
  expect(saved.results.statements).toHaveLength(2);expect(saved.results.statements[1].figureId).toBe(result.panels[1].figure.id);expect(saved.results.statements[1].limitations).toBe(record.results.statements[0].limitations);
  expect(result.panels[1].figure.style.annotationLabels).toBe('key');
  await page.reload();await expect(compound.getByLabel('Multi-panel title',{exact:true})).toHaveValue('Linked acquisitions');await expect(compound.getByLabel('Share value range',{exact:true})).toBeChecked();
  const download=page.waitForEvent('download');await compound.locator(':scope > header').getByRole('button',{name:'Download data',exact:true}).click();const file=await download;expect(await file.failure()).toBeNull();expect(await readFile(await file.path(),'utf8')).toContain('Acquisition window');
  await page.setViewportSize({width:390,height:844});await compound.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('compound-phone.png')});
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader .figure-panel')).toHaveCount(2);await page.locator('.record-reader').getByText('Read table row by row',{exact:true}).last().click();await expect(page.locator('.record-reader .figure-annotations-table')).toContainText('Acquisition window');await page.screenshot({path:test.info().outputPath('compound-reading.png')});
  const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'restored')),{vault:f.vault}),restored=(await new Workspace(backup,f.vault).read()).book.entries.find(r=>r.id===record.id);expect(restored.figures).toEqual(saved.figures);
  const publication=buildPublication({...book,entries:[{...saved,share:true}]});expect([...publication.files.values()].map(String).join('\n')).toContain('Acquisition window');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
