import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {revealInEditor} from './record-editor-helper.js';

test('copy a calculated plot into panels and inspect its exact source chain while reading the lab book',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-reading-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];book.entries=[record];record.figures=[];record.sections=[];record.attachments=[];record.relations=[];delete record.results;
 const f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),bytes=Buffer.from('Counter,Value\n18446744073709551615,2\n18446744073709551616,3');
 const session=await materials.startImport({recordId:record.id,name:'PRIVATE-returned.csv',size:bytes.length});await materials.appendImport(session.id,0,[bytes]);const artifact=await materials.finishImport(session.id);
 const columns=[['Counter','integer'],['Value','decimal']].map(([name,representation])=>({name,representation,radix:10,unit:'',missing:[],time:{kind:'none',reference:'',resolution:'',uncertainty:''}}));
 const dataset=await materials.dataset({recordId:record.id,title:'Exact returned observations',artifact,columns}),mapping={x:0,xKind:'category',values:[{column:1,error:null}],group:null,operation:'raw',kind:'line',order:'source',mode:'replace',decimal:'.'};
 const calculation=await materials.plot({recordId:record.id,title:'Calculated response',dataset,mapping});
 const expectedRevision=recordRevision(record);record.figures=[calculation.figure];await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision,record}]});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const dialog=page.locator('#dialog'),editor=page.getByRole('dialog',{name:'Edit Figure',exact:true}),picker=page.getByRole('dialog',{name:'Copy saved plot',exact:true});page.on('request',r=>{if(new URL(r.url()).pathname==='/api/research/records/values/save')writes.push(r);});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await (await revealInEditor(page,page.getByRole('button',{name:'Add multi-panel figure',exact:true}),'Evidence and results')).click();const area=async value=>{await expect(editor.locator('[data-fe-part]')).toBeEnabled();await editor.locator('[data-fe-part]').selectOption(value);await expect(editor.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');};
  // The multi-panel figure is edited in the retained property editor: the figure title is its first property,
  // and each saved plot copied into it becomes a panel whose observations keep their calculation source.
  await expect(editor.locator('[data-fe-value]')).toHaveValue('Data figure');await editor.locator('[data-fe-value]').fill('Linked source panels');await expect(editor.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');
  for(let i=0;i<2;i++){await editor.getByRole('button',{name:'Copy saved plot',exact:true}).click();await picker.getByRole('button',{name:calculation.figure.title,exact:true}).click();await expect(picker).not.toBeVisible();await expect(editor.locator('[data-fe-panel]')).toHaveAttribute('max',String(i+1));await editor.locator('[data-fe-panel]').fill(String(i+1));await editor.locator('[data-fe="panel"]').click();await area('points');await expect(editor.getByRole('button',{name:'Inspect original calculation',exact:true})).toHaveCount(1);await area('figure');}
  await editor.getByRole('button',{name:'Save changes',exact:true}).click();await expect(editor).not.toBeVisible();
  const saved=await f.workspace.read(),stored=saved.book.entries[0];const composed=await new RetainedFigureDocuments(f.workspace).open(stored.figures[1]),panels=(await composed.window({collection:'panels',offset:0,limit:4})).items;expect(panels).toHaveLength(2);
  for(const panel of panels){const series=(await composed.window({collection:'series',plotId:panel.plotId,offset:0,limit:1})).items[0],point=(await composed.window({collection:'points',plotId:panel.plotId,seriesId:series.id,offset:0,limit:1})).items[0];expect(point.value.source.origin.ref).toEqual(calculation.ref);}expect(stored.results).toBeUndefined();
  await page.reload();await expect(page.locator('.record-reader h1')).toHaveText(record.title);
  await page.evaluate(id=>location.hash='#/notebooks/'+id,record.notebookId);await page.getByRole('button',{name:'Read lab book',exact:true}).click();
  const reader=page.locator('[data-reading-record]');await expect(reader).toHaveCount(1);await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
  await reader.getByRole('button',{name:'Inspect calculation',exact:true}).last().click();await expect(dialog.getByRole('heading',{name:'Calculated response',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Add retained figure to record',exact:true})).toHaveCount(0);await expect(dialog).toContainText(calculation.ref.revision);
  await dialog.getByText('Calculation coverage',{exact:true}).click();await dialog.getByRole('button',{name:'Inspect source rows & exclusions',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Dataset values',exact:true})).toContainText('18446744073709551615');await expect(dialog.getByRole('button',{name:'Edit schema & exclusions',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:/Inspect value.*Counter/}).first().click();await expect(dialog.locator('[data-measurement-inspection]')).toContainText('18446744073709551615');
  await expect(dialog.locator('[data-action="material-measurement-retain"]')).toHaveCount(0);
  await dialog.locator('[data-action="material-measurement-inspect"]').filter({hasText:'Inspect original'}).click();
  const download=page.waitForEvent('download');await dialog.locator('[data-action="material-measurement-download"]').click();expect(await readFile(await (await download).path())).toEqual(bytes);
  await dialog.locator('[data-action="material-measurement-back-source"]').click();await dialog.locator('[data-action="material-measurement-back-source"]').click();
  await dialog.getByRole('button',{name:'Back to previous evidence',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Calculated response',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(reader).toHaveCount(1);expect(writes).toHaveLength(1);expect(await f.workspace.read()).toEqual(saved);expect(errors).toEqual([]);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await reader.getByRole('button',{name:'Inspect calculation',exact:true}).last().scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('figure-source-reading-phone.png')});
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
