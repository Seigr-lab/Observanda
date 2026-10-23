import {figureProperty,discardFigureEdit} from './figure-authoring-controls.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {PublicationJobs} from '../../src/publication-jobs.js';
import {websiteWorkspace} from '../../src/website-workspace.js';
import {withPublicationCapture} from '../../src/publication-capture.js';
import {publicationDraftCommand} from '../publication-fixture.js';
import {defaultEditionRecord} from '../../src/web/publication-selection.js';
import {recordRevision} from '../../src/research.js';
import {contentBuffer} from '../../src/file-content.js';

test('author reversed axes and native-base labels, preserve them in reader and publication',async({page},info)=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-axes-ui-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],plot=createFigure();
 plot.kind='scatter';plot.x.label='Timing (s)';plot.y.label='State';plot.series[0].points=[{x:1,y:10,error:null},{x:5,y:50,error:null},{x:9,y:90,error:null}];record.figures=[plot];
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const dialog=page.getByRole('dialog',{name:'Edit Figure',exact:true});
 const edit=async()=>{const enter=page.getByRole('button',{name:'Edit record',exact:true});await expect(enter.or(page.getByRole('button',{name:'Read record',exact:true}))).toBeVisible();if(await enter.isVisible())await enter.click();await page.getByRole('button',{name:'Edit figure '+plot.title,exact:true}).click();await expect(dialog.locator('[data-fe-value]')).toHaveValue(plot.title);};
 const area=async value=>{await dialog.locator('[data-fe-part]').selectOption(value);await expect(dialog.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');};
 const set=async(property,value)=>{await expect(dialog.locator('[data-fe-property]')).toBeEnabled();await figureProperty(dialog,property);const input=dialog.locator('[data-fe-value]');await expect(input).toBeEnabled();if(typeof value==='boolean')await input.setChecked(value);else if(await input.evaluate(node=>node.tagName==='SELECT'))await input.selectOption(value);else await input.fill(value);await dialog.locator('[data-fe="apply"]').click();await expect(dialog.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await edit();await set('x.reversed',true);await set('y.reversed',true);
  await area('ticks');for(const [value,label]of [['1','Before transition'],['1.00001','After transition'],['9','Final acquisition']]){await dialog.locator('[data-fe="add"]').click();await expect(dialog.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');await set('axis','x');await set('value',value);await set('label',label);}
  await area('figure');await set('style.numberFormat','radix');await set('style.radix','6');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await page.reload();await edit();
  await figureProperty(dialog,'x.reversed');await expect(dialog.locator('[data-fe-value]')).toBeChecked();await figureProperty(dialog,'y.reversed');await expect(dialog.locator('[data-fe-value]')).toBeChecked();await figureProperty(dialog,'style.numberFormat');await expect(dialog.locator('[data-fe-value]')).toHaveValue('radix');await figureProperty(dialog,'style.radix');await expect(dialog.locator('[data-fe-value]')).toHaveValue('6');
  await discardFigureEdit(dialog);await page.getByRole('button',{name:'Read record',exact:true}).click();await page.locator('#record-figure-'+plot.id).getByRole('button',{name:'Open retained figure',exact:true}).click();
  const reading=page.getByRole('dialog',{name:'Retained figure',exact:true});await expect(reading.locator('.figure-custom-tick')).toHaveCount(3);await expect(reading.locator('.figure-generated-tick-label').first()).toContainText('6#');await reading.locator('svg').screenshot({path:info.outputPath('axes-reader.png')});
  const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id),retained=await new RetainedFigureDocuments(f.workspace).open(saved.figures[0]);let json='';for await(const chunk of retained.json())json+=chunk;const exact=JSON.parse(json);expect(exact.x.ticks[1].value).toBe(1.00001);expect(exact.x.reversed).toBe(true);expect(exact.y.reversed).toBe(true);expect(exact.style.radix).toBe(6);expect(exact.style.numberFormat).toBe('radix');expect(exact.series[0].points).toEqual(plot.series[0].points);
  const publicBook={...book,entries:[{...saved,share:true}]},command=await publicationDraftCommand(f.workspace,publicBook),choice=defaultEditionRecord(publicBook.entries[0],recordRevision(publicBook.entries[0])),storage=websiteWorkspace(f.workspace,null),releases=new PublicationJobs(storage),source=await withPublicationCapture(storage,async(workspace,id,finish)=>{const pinned=await releases.pin({...command,edition:{version:1,records:[choice]}},{workspace,id});return finish(()=>pinned);}),job={id:source.id,lease:{token:randomUUID()}},candidate=await releases.prepare(job,{progress:async()=>{}});await storage.withLock(()=>releases.commit(job,candidate));const edition=await releases.read(candidate.reviewId),svg=(await contentBuffer(await edition.files.get('figures/'+record.id+'-'+plot.id+'.svg'))).toString('utf8');expect(svg).toContain('After transition');expect(svg).toContain('Final acquisition');expect(svg).toContain('6#10');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
