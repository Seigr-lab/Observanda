
import {test,expect} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {workDirectory} from '../../scripts/work-directory.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {startServer} from '../../src/server.js';
import {createSeries} from '../../src/web/figure-model.js';
import writingMessages from '../../src/web/locales/en/recordWriting.json' with {type:'json'};
import contentMessages from '../../src/web/locales/en/recordContent.json' with {type:'json'};
import editorMessages from '../../src/web/locales/en/editorControls.json' with {type:'json'};
// A saved record opens in its editing view: the summary is written in its own
// dialog, and stored figures are duplicated from the evidence group.
test('formatted research links and multiple series survive save, duplication and reopen',async({page})=>{
 const book=sampleNotebook(),record=book.entries[0],[figure]=record.figures,treatment=createSeries('Treatment',1);
 treatment.points=figure.series[0].points.map(point=>({...point,y:point.y*2,error:.5}));figure.series.push(treatment);figure.legend=true;
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'shared-content-')),{workspace:ws,deviceStore}=await encryptedFixture(directory,book);
 const preferencesFile=path.join(directory,'preferences.json'),settings=defaultDashboard();settings.enabledModules.push('planning');await writeWorkspaceDashboard(ws,settings,(await readWorkspaceDashboard(ws)).etag);const app=await startServer({root:ws.root,port:0,preferencesFile,deviceStore});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const saved=async()=>(await ws.read()).book.entries.find(entry=>entry.id===record.id);
 const writing=page.getByRole('dialog',{name:writingMessages.summary,exact:true}),editor=writing.locator('.ProseMirror');
 const openSummary=()=>page.getByRole('button',{name:contentMessages.editSummary,exact:true}).click();
 const duplicates=page.locator('[data-action="stored-figure-duplicate"]'),evidence=page.locator('[data-disclosure="record-evidence"]');
 const openEvidence=async()=>{if(!await evidence.evaluate(group=>group.open))await evidence.locator(':scope>summary').click();};
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await openSummary();
  await editor.fill('Comparing the reference experiment');
  await editor.press('Control+a');await editor.press('Control+b');
  await writing.locator('.document-tools [data-rich-command="link"]').first().click();
  const dialog=page.getByRole('dialog',{name:editorMessages.linkSettings});
  await dialog.getByRole('searchbox').fill(book.entries[1].title);
  await dialog.locator('[data-rich-destination]:visible').click();
  await dialog.getByRole('button',{name:editorMessages.linkApply,exact:true}).click();
  await expect(editor.locator('a')).toHaveAttribute('href',/observanda:/);
  await expect(editor.locator('strong')).toContainText('Comparing');
  await writing.getByRole('button',{name:writingMessages.save,exact:true}).click();await expect(writing).not.toBeVisible();
  expect((await saved()).body.content[0].content[0].marks.map(m=>m.type)).toEqual(expect.arrayContaining(['strong','link']));
  await openEvidence();
  // The reader moves its figure window to the new copy (src/web/record-figure-actions.js reveal);
  // a fresh reading starts at the first figure and shows both.
  await duplicates.first().click();await expect(duplicates).toHaveCount(1);await expect(duplicates).not.toHaveAttribute('data-figure',figure.id);
  await expect.poll(async()=>(await saved()).figures.length).toBe(2);
  const original=(await saved()).figures.find(item=>item.id===figure.id);
  expect(original.series).toHaveLength(2);expect(original.series[1].points[1].error).toBe(.5);expect(original.series[1].points[2].y).toBe(16);
  await openSummary();await editor.click();await editor.press('Control+End');await editor.pressSequentially(' Further observation.');
  await writing.getByRole('button',{name:writingMessages.save,exact:true}).click();await expect(writing).not.toBeVisible();
  await expect.poll(async()=>JSON.stringify((await saved()).body)).toContain('Further observation.');
  await page.reload();await expect(duplicates).toHaveCount(2);
  await expect(page.locator('[data-record-edit-area="summary"] .prose a')).toContainText('Comparing');
  await openEvidence();
  await page.locator('[data-record-edit-area="figures"]').evaluate(node=>scrollTo(0,node.getBoundingClientRect().top+scrollY-80));
  await page.screenshot({path:path.join(directory,'figures-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(directory,'writing-phone.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Calendar & planning',exact:true}).click();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await page.getByRole('textbox',{name:'Task title',exact:true}).fill('Compare observations');
  const note=page.getByRole('textbox',{name:'Work to do',exact:true});
  await note.fill('Use the same reference experiment');await note.press('Control+a');await note.press('Control+i');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('Saved.');
  await page.reload();await expect(page.getByRole('textbox',{name:'Work to do',exact:true}).locator('em')).toContainText('Use the same');
  expect(errors).toEqual([]);
 }finally{await new Promise(r=>app.server.close(r));}
});
