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
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {revealInEditor} from './record-editor-helper.js';
import {figureProperty,discardFigureEdit} from './figure-authoring-controls.js';

test('author, annotate, compare, save and restore multi-panel figures through the app',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-panels-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.figures=[1,2].map(n=>{const f=createFigure();f.title='Acquisition '+n;f.x.label='Time (s)';f.y.label='Voltage (V)';f.series[0].points=[{x:0,y:n,error:.1},{x:1,y:n+1,error:.2}];return f;});
 record.results={version:1,statements:[{id:randomUUID(),kind:'figure',figureId:record.figures[0].id,title:'Acquisition interpretation',text:'Two measurements in this acquisition.',limitations:'No claim about other apparatus states.',basis:'authored',source:null}]};
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  // The multi-panel figure is edited in the retained property editor ("Edit Figure"): one editing area,
  // property and panel at a time; panels are saved plots copied into it.
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await (await revealInEditor(page,page.getByRole('button',{name:'Add multi-panel figure',exact:true}),'Evidence and results')).click();const compound=page.getByRole('dialog',{name:'Edit Figure',exact:true}),picker=page.getByRole('dialog',{name:'Copy saved plot',exact:true});
  const idle=()=>expect(compound.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');
  const area=async value=>{await expect(compound.locator('[data-fe-part]')).toBeEnabled();await compound.locator('[data-fe-part]').selectOption(value);await idle();};
  const apply=async()=>{await compound.locator('[data-fe="apply"]').click();await idle();await expect(compound.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');};
  await expect(compound.locator('[data-fe-value]')).toHaveValue('Data figure');await (await figureProperty(compound,'title')).fill('Linked acquisitions');await apply();await (await figureProperty(compound,'layout.linkX')).check();await apply();await (await figureProperty(compound,'layout.linkY')).check();await apply();
  for(const title of ['Acquisition 1','Acquisition 2']){await compound.getByRole('button',{name:'Copy saved plot',exact:true}).click();await picker.getByRole('button',{name:title,exact:true}).click();await expect(picker).not.toBeVisible();}await expect(compound.locator('[data-fe-panel]')).toHaveAttribute('max','2');
  await area('annotations');await compound.locator('[data-fe="add"]').click();await compound.locator('[data-fe-key="kind"]').selectOption('interval');await compound.locator('[data-fe-key="axis"]').selectOption('x');const annotations=compound;
  await annotations.getByLabel('Annotation label',{exact:true}).fill('Acquisition window');await annotations.getByLabel('Position / interval start',{exact:true}).fill('0.25');await annotations.getByLabel('Interval end',{exact:true}).fill('0.75');await apply();
  await expect(compound).toContainText('1 of 1');
  await area('plot');await (await figureProperty(compound,'style.annotationLabels')).selectOption('key');await apply();
  await compound.locator('[data-fe="preview"]').click();await idle();await expect(compound.locator('[data-fe-preview] svg').first()).toBeVisible();
  await compound.locator('[data-fe-panel]').fill('2');await compound.locator('[data-fe="panel"]').click();await idle();await area('points');await (await figureProperty(compound,'y')).fill('5');await apply();await expect(compound.locator('[data-fe-panel]')).toHaveAttribute('max','2');
  await area('panels');await compound.locator('[data-fe-position]').fill('2');await compound.locator('[data-fe="position"]').click();await idle();await compound.locator('[data-fe="move-earlier"]').click();await idle();await expect(compound).toContainText('1 of 2');
  const save=page.waitForResponse(r=>r.url().endsWith('/api/research/records/values/save'));await compound.locator('[data-writing="save"]').click();expect((await save).ok()).toBe(true);await expect(compound).not.toBeVisible();
  const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id),result=saved.figures.at(-1),composed=await new RetainedFigureDocuments(f.workspace).open(result),panels=(await composed.window({collection:'panels',offset:0,limit:4})).items;
  const firstPoint=async plotId=>{const series=(await composed.window({collection:'series',plotId,offset:0,limit:1})).items[0];return (await composed.window({collection:'points',plotId,seriesId:series.id,offset:0,limit:1})).items[0].value;};
  expect((await composed.header()).header).toMatchObject({kind:'panels',layout:{linkX:true,linkY:true}});expect(panels).toHaveLength(2);expect((await firstPoint(panels[0].plotId)).y).toBe(5);expect(saved.figures[1].series[0].points[0].y).toBe(2);expect((await composed.window({collection:'annotations',plotId:panels[1].plotId,offset:0,limit:1})).items[0].value.end).toBe(.75);
  expect(saved.results.statements).toHaveLength(2);expect(saved.results.statements[1].figureId).toBe(panels[1].plotId);expect(saved.results.statements[1].limitations).toBe(record.results.statements[0].limitations);
  expect((await composed.header({plotId:panels[1].plotId})).header.style.annotationLabels).toBe('key');
  await page.reload();await (await revealInEditor(page,page.getByRole('button',{name:'Edit figure Linked acquisitions',exact:true}),'Evidence and results')).click();await expect(compound.locator('[data-fe-value]')).toHaveValue('Linked acquisitions');await expect(await figureProperty(compound,'layout.linkY')).toBeChecked();await discardFigureEdit(compound);
  await (await revealInEditor(page,page.locator('[data-action="material-retained-figure"][data-figure-id="'+result.id+'"]'),'Evidence and results')).click();const retained=page.getByRole('dialog',{name:'Retained figure',exact:true});
  const download=page.waitForEvent('download');await retained.getByRole('link',{name:'CSV',exact:true}).click();const file=await download;expect(await file.failure()).toBeNull();expect(await readFile(await file.path(),'utf8')).toContain('Acquisition window');
  await page.setViewportSize({width:390,height:844});await retained.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('compound-phone.png')});await retained.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader .figure-panel')).toHaveCount(2);await page.locator('.record-reader').getByText('Read table row by row',{exact:true}).last().click();await expect(page.locator('.record-reader .figure-annotations-table')).toContainText('Acquisition window');await page.screenshot({path:test.info().outputPath('compound-reading.png')});
  const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'restored'),{vault:f.vault}),{vault:f.vault}),restored=(await new Workspace(backup,f.vault).read()).book.entries.find(r=>r.id===record.id);expect(restored.figures).toEqual(saved.figures);
  const publication=buildPublication({...book,entries:[{...saved,share:true}]});expect([...publication.files.values()].map(String).join('\n')).toContain('Acquisition window');expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
