import {test,expect} from '@playwright/test';
import path from 'node:path';
import {mediaValueFixture} from '../record-media-values-fixture.js';
import {testServer} from '../device-fixture.js';

test('a photograph records its creator, licence, capture date with uncertain precision, subject and private location',async({page})=>{
 test.setTimeout(120000);
 const f=await mediaValueFixture({count:3}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const dialog=page.getByRole('dialog',{name:'Edit Media details',exact:true}),image=f.record.attachments[0];
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
  await page.getByRole('button',{name:'Edit media details for Media 0',exact:true}).click();
  const details=dialog.getByRole('group',{name:'Source and capture',exact:true});
  await details.getByLabel('Creator (photographer, recordist or author)',{exact:true}).fill('A. Recorder');
  await details.getByLabel('Credit line',{exact:true}).fill('Field survey team');
  await details.getByLabel('Licence',{exact:true}).fill('CC BY 4.0');
  // A time of capture needs an exact day; with only a year it stays disabled.
  await details.getByLabel('Date precision',{exact:true}).selectOption('year');
  await details.getByLabel('Year',{exact:true}).fill('1911');await details.getByLabel('Estimated date',{exact:true}).check();
  await expect(details.getByLabel('Time of capture',{exact:true})).toBeDisabled();
  await details.getByLabel('Date precision',{exact:true}).selectOption('day');
  await details.getByLabel('Captured',{exact:true}).last().fill('2026-05-02');
  // The estimate applied to the year; this exact day is known.
  await expect(details.getByLabel('Estimated date',{exact:true})).toBeChecked();await details.getByLabel('Estimated date',{exact:true}).uncheck();
  await details.getByLabel('Time of capture',{exact:true}).fill('6:41');
  await expect(details.locator('[data-media-metadata-error]')).toHaveText('Enter the time as HH:MM or HH:MM:SS, optionally followed by Z or an offset such as +02:00.');
  await details.getByLabel('Time of capture',{exact:true}).fill('06:41:07+02:00');await expect(details.locator('[data-media-metadata-error]')).toHaveText('');
  await details.getByLabel('Subject (species, object or scene)',{exact:true}).fill('Lapwing (Vanellus vanellus)');
  await details.getByLabel('Location (private)',{exact:true}).fill('Private site 7, 59.91234 N 10.75012 E');
  await details.getByLabel('Archive, collection or catalogue reference',{exact:true}).fill('Survey archive box 12');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=(await f.values.read(f.target(image.id))).value.value.metadata;
  expect(saved).toEqual({creator:'A. Recorder',credit:'Field survey team',licence:'CC BY 4.0',capturedOn:'2026-05-02',capturedTime:'06:41:07+02:00',subject:'Lapwing (Vanellus vanellus)',location:'Private site 7, 59.91234 N 10.75012 E',source:'Survey archive box 12'});
  // The reader shows the attribution line; the location only inside the collapsed provenance.
  await page.getByRole('button',{name:'Read record',exact:true}).click();
  const figure=page.locator('#record-figure-'+image.id);
  await expect(figure.locator('.record-media-credit')).toHaveText('By A. Recorder · Field survey team · CC BY 4.0 · 2026-05-02 06:41:07+02:00');
  await expect(figure.locator('img')).toHaveAttribute('loading','lazy');
  await figure.getByText('Source and capture',{exact:true}).click();
  await expect(figure.locator('.record-media-metadata')).toContainText('Private site 7');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 }finally{await app.close();await f.close();}
});
