import {test,expect} from '@playwright/test';
import {completeRunCreation} from './run-creation-controls.js';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {buildPublication} from '../../src/publication.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {randomUUID} from 'node:crypto';
import {attemptFixture,fact} from '../fixtures/attempts.js';

test('preparation, assessment, amendment and repeat are dedicated app journeys with private source references',async({page,browser},testInfo)=>{
 test.setTimeout(150000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-attempt-ui-')),book=sampleNotebook(),[investigation,method]=book.entries;
 for(const e of book.entries){e.figures=[];e.attachments=[];e.relations=[];e.sections=[];e.share=false;}
 investigation.title='Synthetic recognition investigation';investigation.type='experiment';investigation.share=true;
 method.title='PRIVATE recognition method';method.type='protocol';method.body='Original independent decoding instructions';
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')}),errors=[],wholeReads=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(new URL(r.url()).pathname==='/api/workspace/read/page')wholeReads.push(r.url());});
 const dialog=page.locator('#dialog'),form=page.locator('#attempt-form');
 const save=async()=>{await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');};
 const add=async()=>{await form.getByRole('button',{name:'Add to record',exact:true}).click();await expect(dialog).not.toBeVisible();await save();};
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,investigation.id);
  await page.getByRole('button',{name:'Add run or take',exact:true}).click();await completeRunCreation(page,'Recognition attempt one');
  const firstId=(await f.workspace.read()).book.entries.find(r=>r.title==='Recognition attempt one').id,materials=new ResearchMaterials(f.workspace),bytes=Buffer.from('Synthetic native receipt, never a physical measurement');
  const upload=await materials.startImport({recordId:firstId,name:'PRIVATE-native-receipt.txt',size:bytes.length,provenance:'Synthetic receipt'});
  await materials.appendImport(upload.id,0,[bytes]);const receipt=await materials.finishImport(upload.id);
  const analysis=await materials.analysis({recordId:firstId,title:'PRIVATE independent decoder',inputs:[receipt],tool:'Synthetic decoder',version:'1',parameters:'No recognition reference supplied',outputs:[]});
  await page.locator('.attempt-editor > summary').click();await page.getByRole('button',{name:'Prepare an attempt',exact:true}).click();
  await form.getByLabel('Applies to',{exact:true}).fill('First physical attempt before acquisition');
  await form.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Stay here',exact:true}).click();await expect(form.getByLabel('Applies to',{exact:true})).toHaveValue('First physical attempt before acquisition');
  await form.getByRole('group',{name:'Exact methods',exact:true}).getByRole('button',{name:'Choose saved record revision',exact:true}).click();
  await form.getByRole('button',{name:/PRIVATE recognition method/}).click();
  await form.getByRole('button',{name:'Add condition',exact:true}).click();
  const condition=form.locator('[data-row="conditions.0"]');await condition.getByLabel('Name',{exact:true}).fill('Window size');await condition.getByLabel('Declared value',{exact:true}).fill('120');await condition.getByLabel('Declared unit',{exact:true}).fill('samples');
  for(const [label,expected] of [['Native logging','Every native record decodes'],['Recognition','Requested pattern recognized']]){
   await form.getByRole('button',{name:'Add criterion',exact:true}).click();const criterion=form.locator('[data-row^="criteria."]').last();
   await criterion.getByLabel('Label',{exact:true}).fill(label);await criterion.getByLabel('Expected value / condition',{exact:true}).fill(expected);await criterion.getByLabel('Comparator / assessment rule',{exact:true}).fill('Independent reference comparison');await criterion.getByLabel('Denominator / population',{exact:true}).fill('One physical attempt');
  }
  await add();await expect(page.locator('.attempt-editor')).toContainText('No assessment recorded');
  await page.getByRole('button',{name:'Record event',exact:true}).click();await form.getByLabel('Event kind',{exact:true}).selectOption('acquired');await form.getByLabel('Event completion',{exact:true}).selectOption('complete');await form.getByLabel('Observation context',{exact:true}).selectOption('host');
  await form.getByLabel('Time meaning',{exact:true}).selectOption('device-counter');await form.getByLabel('Declared time / counter value',{exact:true}).fill('10000000000000001 (base 6)');await add();
  for(const [criterion,outcome,observed] of [['Native logging','met','246 acquired records decoded'],['Recognition','unresolved','Independent physical reference missing']]){
   await page.getByRole('button',{name:'Assess criterion',exact:true}).click();await form.getByLabel('Criterion',{exact:true}).selectOption({label:criterion});await form.getByLabel('Assessment outcome',{exact:true}).selectOption(outcome);await form.getByLabel('Observed value / condition',{exact:true}).fill(observed);await form.getByLabel('Denominator / population',{exact:true}).fill('One physical attempt');await form.getByLabel('Reason / limitations',{exact:true}).fill('Acquisition does not establish recognition');
   await form.getByRole('button',{name:'Choose retained evidence or analysis',exact:true}).click();await form.locator('#attempt-material').selectOption('analysis:'+analysis.id+':'+analysis.revision);await form.getByRole('button',{name:'Use this revision',exact:true}).click();await expect(form).toContainText('PRIVATE independent decoder');await add();
  }
  let snapshot=await f.workspace.read(),first=snapshot.book.entries.find(r=>r.title==='Recognition attempt one');expect(first.status).toBe('planned');expect(first.outcome).toBe('');
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Recognition — Unresolved');await expect(page.locator('.record-reader')).toContainText('Evidence acquired — Complete');
  await page.locator('.record-reader [data-action="attempt-open-ref"]').first().click();await expect(dialog).toContainText('Original independent decoding instructions');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.record-reader [data-action="attempt-open-ref"]').filter({hasText:'PRIVATE independent decoder'}).first().click();await expect(dialog).toContainText('No recognition reference supplied');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await page.getByRole('button',{name:'Add correction: Recognition',exact:true}).click();await expect(form.getByLabel('Criterion',{exact:true}).locator('option')).toHaveCount(1);await form.getByLabel('Reason / limitations',{exact:true}).fill('Receipt reviewed again; recognition remains unresolved');await form.getByLabel('Observed value / condition',{exact:true}).fill('Reference still missing after receipt review');await add();
  await page.reload();await expect(page.locator('.attempt-editor')).toContainText('Reference still missing after receipt review');await page.locator('.attempt-editor').getByText('Superseded assessments and events',{exact:true}).click();await expect(page.locator('.attempt-editor')).toContainText('Independent physical reference missing');
  await page.getByRole('button',{name:'Read record',exact:true}).click();
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await page.getByRole('button',{name:'Create another run or take',exact:true}).click();await completeRunCreation(page,'Recognition attempt two');
  await expect(page.locator('.attempt-editor')).toContainText('Inherited, not remeasured');await expect(page.locator('.attempt-editor')).not.toContainText('Recognition — Unresolved');
  await page.getByRole('button',{name:'Amend preparation',exact:true}).click();await form.getByLabel('Reason / limitations',{exact:true}).first().fill('Deliberate parameter change before second acquisition');await form.locator('[data-row="conditions.0"]').getByLabel('Declared value',{exact:true}).fill('240');await add();
  await page.getByRole('button',{name:'Read record',exact:true}).click();await page.getByRole('link',{name:'Synthetic recognition investigation',exact:true}).click();await page.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();await expect(page.getByRole('region',{name:'Run comparison'})).toContainText('Differs from the first run');
  await page.getByRole('link',{name:'Recognition attempt one',exact:true}).first().click();await expect(page.locator('.record-reader h1')).toHaveText('Recognition attempt one');await page.setViewportSize({width:390,height:844});await page.locator('.attempt-assessment').first().scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('attempt-reader-phone.png')});
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Edit record',exact:true}).click();await page.getByLabel('Include in website',{exact:false}).check();await save();
  snapshot=await f.workspace.read();first=snapshot.book.entries.find(r=>r.id===first.id);const output=buildPublication(snapshot.book),html=output.files.get('entries/'+first.id+'.html');expect(html).not.toContain('PRIVATE recognition method');expect(html).not.toContain('PRIVATE independent decoder');expect(html).not.toContain(analysis.id);expect(html).toContain('Recognition — Unresolved');
  const publicContext=await browser.newContext({javaScriptEnabled:false}),publicPage=await publicContext.newPage();
  await publicPage.route('https://attempt.invalid/**',route=>{const name=new URL(route.request().url()).pathname.slice(1),value=output.files.get(name);return route.fulfill({status:typeof value==='string'?200:404,contentType:name.endsWith('.css')?'text/css':'text/html',body:typeof value==='string'?value:''});});
  await publicPage.goto('https://attempt.invalid/entries/'+first.id+'.html');await expect(publicPage.locator('.attempt-details')).toContainText('Recognition — Unresolved');await expect(publicPage.locator('.attempt-details')).toContainText('Evidence acquired — Complete');await publicPage.screenshot({path:testInfo.outputPath('attempt-public.png'),fullPage:true});await publicContext.close();
  expect(errors).toEqual([]);expect(wholeReads).toEqual([]);
 }catch(error){await testInfo.attach('attempt-dom',{body:await page.content(),contentType:'text/html'});throw error;}
 finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('conflicting assessment corrections retain the checkpoint and cannot overwrite saved facts',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-attempt-conflict-')),book=sampleNotebook(),base=book.entries[0];
 base.attempt=attemptFixture();const f=await encryptedFixture(directory,book),mine=structuredClone(base),stored=structuredClone(base),prior=base.attempt.assessments[1];
 mine.attempt.assessments.push({...prior,...fact(),supersedes:prior.id,outcome:'unavailable',reason:'Unfinished local interpretation'});
 stored.attempt.assessments.push({...prior,...fact(),supersedes:prior.id,outcome:'not-met',reason:'Separately saved interpretation'});
 const drafts=new ResearchDrafts(f.workspace),checkpoint=randomUUID();await drafts.write({id:checkpoint,workspaceId:book.id,expectedRevision:null,changes:[{base,record:mine,expectedRevision:recordRevision(base)}]});
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:stored}]});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);
  const open=async()=>{await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();};
  await open();await page.locator('.record-draft-preview').getByRole('button',{name:'Recover this draft',exact:true}).click();const dialog=page.locator('.record-draft-review'),versions=dialog.locator('.record-conflict-versions > section');
  await versions.filter({has:page.getByRole('heading',{name:'Your draft',exact:true})}).getByRole('button',{name:'Keep this version',exact:true}).click();await dialog.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('cannot be overwritten or removed');expect((await f.workspace.read()).book.entries[0].attempt).toEqual(stored.attempt);expect((await drafts.read(checkpoint)).draft.changes[0].record).toEqual(mine);
  await dialog.getByRole('button',{name:'Close review',exact:true}).click();await open();await page.locator('.record-draft-preview').getByRole('button',{name:'Recover this draft',exact:true}).click();await versions.filter({has:page.getByRole('heading',{name:'Current saved version',exact:true})}).getByRole('button',{name:'Keep this version',exact:true}).click();await dialog.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(dialog).not.toBeVisible();expect(await drafts.read(checkpoint)).toBeNull();
  expect((await f.workspace.read()).book.entries[0].attempt).toEqual(stored.attempt);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
