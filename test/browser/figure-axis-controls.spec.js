import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {buildPublication} from '../../src/publication.js';

test('author reversed axes and native-base labels, preserve them in reader and publication',async({page},info)=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-axes-ui-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],plot=createFigure();
 plot.kind='scatter';plot.x.label='Timing (s)';plot.y.label='State';plot.series[0].points=[{x:1,y:10,error:null},{x:5,y:50,error:null},{x:9,y:90,error:null}];record.figures=[plot];
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const dialog=page.getByRole('dialog',{name:'Edit Figure',exact:true}),figure=dialog.locator('[data-figure-id]'),settings=figure.locator('.figure-axis-controls');
 const edit=async()=>{const enter=page.getByRole('button',{name:'Edit record',exact:true});await expect(enter.or(page.getByRole('button',{name:'Read record',exact:true}))).toBeVisible();if(await enter.isVisible())await enter.click();await page.getByRole('button',{name:'Edit figure '+plot.title,exact:true}).click();};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await edit();
  await settings.locator('summary').click();const x=settings.locator('[data-axis-control="x"]'),y=settings.locator('[data-axis-control="y"]');
  await x.getByLabel('Reverse axis direction',{exact:true}).check();await y.getByLabel('Reverse axis direction',{exact:true}).check();
  for(const [i,value,label] of [[0,'1','Before transition'],[1,'1.00001','After transition'],[2,'9','Final acquisition']]){
   await x.getByRole('button',{name:'Add tick label',exact:true}).click();const tick=x.locator('[data-axis-tick="'+i+'"]');await tick.getByLabel('Numeric tick position',{exact:true}).fill(value);await tick.getByLabel('Tick label',{exact:true}).fill(label);
  }
  await expect(figure.locator('.figure-custom-tick')).toHaveCount(3);await figure.getByLabel('Number format',{exact:true}).selectOption('radix');await figure.getByLabel('Numeral base (2–36)',{exact:true}).fill('6');await expect(figure.locator('.figure-value-tick').first()).toContainText('6#');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await page.reload();await edit();
  await expect(x.getByLabel('Reverse axis direction',{exact:true})).toBeChecked();await expect(figure.getByLabel('Number format',{exact:true})).toHaveValue('radix');await expect(figure.getByLabel('Numeral base (2–36)',{exact:true})).toHaveValue('6');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Read record',exact:true}).click();
  const reading=page.locator('#record-figure-'+plot.id);await expect(reading.locator('.figure-custom-tick')).toHaveCount(3);await expect(reading.locator('.figure-value-tick').first()).toContainText('6#');await reading.locator('svg').screenshot({path:info.outputPath('axes-reader.png')});
  const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id);expect(saved.figures[0].x.ticks[1].value).toBe(1.00001);expect(saved.figures[0].x.reversed).toBe(true);expect(saved.figures[0].y.reversed).toBe(true);expect(saved.figures[0].style.radix).toBe(6);expect(saved.figures[0].style.numberFormat).toBe('radix');
  const files=[...buildPublication({...book,entries:[{...saved,share:true}]}).files.values()].map(String).join('\n');expect(files).toContain('After transition');expect(files).toContain('Final acquisition');expect(files).toContain('6#14');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
