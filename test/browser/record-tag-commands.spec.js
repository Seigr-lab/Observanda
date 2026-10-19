import {test,expect} from '@playwright/test';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordContent} from '../../src/record-content.js';
import {RecordTagCommands} from '../../src/record-tag-commands.js';

test('reader tags page, add, rename, remove and retry without opening the full record',async({page},info)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const f=await figureValueFixture({tags:Array.from({length:33},(_,i)=>'capture-'+i)}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Tag authoring opened the full record');};
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 const tags=page.locator('.record-tags'),navigation=page.getByRole('navigation',{name:'Browse tags',exact:true});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(navigation).toContainText('1–4 of 33');await expect(tags.locator('li')).toHaveCount(4);await navigation.getByLabel('Go to item',{exact:true}).fill('33');await navigation.getByRole('button',{name:'Go',exact:true}).click();await expect(tags).toContainText('capture-32');
  await tags.getByRole('button',{name:'Rename tag',exact:true}).click();await tags.getByLabel('Tag name',{exact:true}).fill('Reviewed acquisition');await tags.getByRole('button',{name:'Save tag',exact:true}).click();await expect(tags).toContainText('Reviewed acquisition');await expect(tags.getByLabel('Tag name',{exact:true})).not.toBeVisible();
  let dropped=false;await page.route('**/api/research/records/tags',async route=>{if(dropped)return route.continue();dropped=true;await route.fetch();await route.abort('failed');});await tags.getByLabel('New tag',{exact:true}).fill('Added once');await tags.getByRole('button',{name:'Add tag',exact:true}).click();await expect(tags.getByRole('button',{name:'Retry tag change',exact:true})).toBeVisible();await tags.getByRole('button',{name:'Retry tag change',exact:true}).click();await expect(navigation).toContainText('34–34 of 34');await expect(tags).toContainText('Added once');await page.unroute('**/api/research/records/tags');
  await tags.getByRole('button',{name:'Remove tag',exact:true}).click();await expect(navigation).toContainText('33–33 of 33');await expect(tags).toContainText('Reviewed acquisition');await expect(tags).not.toContainText('Added once');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await tags.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('reader-tags-mobile.png')});await page.reload();await expect(navigation).toContainText('1–4 of 33');expect(errors).toEqual([]);expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});

test('a stale rename retains its entered name until the current target is reviewed',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const f=await figureValueFixture({tags:['First','Second']}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});const tags=page.locator('.record-tags');
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();await tags.locator('li').filter({hasText:'Second'}).getByRole('button',{name:'Rename tag',exact:true}).click();await tags.getByLabel('Tag name',{exact:true}).fill('My retained label');
  let changed=false;await page.route('**/api/research/records/tags',async route=>{if(!changed){changed=true;const reading=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true});await new RecordTagCommands(f.workspace).run({workspaceId:f.book.id,recordId:f.record.id,id:randomUUID(),action:'remove',position:0,tag:null,expectedRevision:reading.collections.tags.revision});}await route.continue();});
  await tags.getByRole('button',{name:'Save tag',exact:true}).click();await expect(tags.getByRole('status')).toContainText('My retained label');await expect(tags.locator('li')).toHaveCount(1);await tags.getByRole('button',{name:'Rename tag',exact:true}).click();await expect(tags.getByLabel('Tag name',{exact:true})).toHaveValue('My retained label');await tags.getByRole('button',{name:'Save tag',exact:true}).click();await expect(tags.locator('li')).toContainText('My retained label');await expect(tags.getByLabel('Tag name',{exact:true})).not.toBeVisible();
 }finally{await app.close();await f.close();}
});
