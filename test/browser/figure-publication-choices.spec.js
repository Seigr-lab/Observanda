import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {createFigure} from '../../src/web/figure-model.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

test('a lab-book figure can be withdrawn or restored independently in an existing website and PDF composition',async({page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(18000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-privacy-')),book=sampleNotebook(),record=book.entries[2];
 const plot=title=>{const figure=createFigure();figure.title=title;figure.series[0].points=[{x:0,y:14,error:null},{x:1,y:17,error:null}];return figure;};
 const withheld=plot('Incubation variance'),sibling=plot('Public baseline');
 const embedded=alternative=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Retained context'}]},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:withheld.id,alternative}}]});
 record.figures=[withheld,sibling];record.body=embedded('Internal variance scale');
 record.sections=[{id:randomUUID(),title:'Method',body:embedded('Secret method label'),share:true,sharePdf:true}];
 record.share=false;record.sharePdf=false;book.notebooks.find(n=>n.id===record.notebookId).sharePdf=true;book.entries=[record];
 const fixture=await encryptedFixture(directory,book),app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const store=new WebsiteFileStore(fixture.workspace),dialog=page.getByRole('dialog');
 const save=async()=>{await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();};
 const choose=async(target,checked)=>{
  await page.locator('[data-value-field="figure-sharing:'+withheld.id+'"]').first().click();
  await expect(dialog.getByRole('group',{name:'Visibility of Incubation variance'})).toBeVisible();
  await dialog.locator('[data-figure-sharing="'+target+'"]').setChecked(checked);await save();
 };
 const source=target=>store.sourceForRecord({workspaceId:book.id,recordId:record.id,target});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  for(const field of ['share','sharePdf']){
   await page.locator('[data-record-publication] [data-value-field="'+field+'"]').click();
   await dialog.locator('[data-record-value]').selectOption('true');await save();
  }
  const website=await source('website'),pdf=await source('pdf'),created=await store.create({name:'Lab results'});
  const placed=await store.insertSource(created.site.id,{sourceId:website.id,sourceRevision:website.revision,expectedRevision:created.site.revision});
  expect(placed.html).toContain(withheld.title);
  const pdfParts=async()=>(await store.pdfSource(pdf.id)).parts,privateTerms=new RegExp([withheld.id,withheld.title,'Internal variance scale','Secret method label'].join('|'));
  await choose('website',false);
  await expect(store.checkRevision(created.site.id,placed.site.revision)).rejects.toMatchObject({code:'CONFLICT'});
  let current=await store.open(created.site.id);expect(current.html).not.toMatch(privateTerms);expect(current.html).toContain(sibling.title);
  const releasedAssets=new Set((await store.getSource(website.id)).assets.map(file=>file.path));expect(releasedAssets.size).toBeGreaterThan(0);
  const published=await store.export(created.site.id,{expectedRevision:current.site.revision});
  expect([...published.files.keys()].filter(file=>file.startsWith('assets/')).sort()).toEqual([...releasedAssets].sort());
  expect((await pdfParts()).figures.map(f=>f.id)).toContain(withheld.id);
  await choose('pdf',false);let parts=await pdfParts();expect(JSON.stringify(parts)).not.toMatch(privateTerms);expect(parts.figures.map(f=>f.id)).toEqual([sibling.id]);
  await choose('website',true);current=await store.open(created.site.id);expect(current.html).toContain(withheld.title);expect(current.html).toContain(sibling.title);expect(JSON.stringify(await pdfParts())).not.toMatch(privateTerms);
  await choose('pdf',true);parts=await pdfParts();expect(parts.figures.map(f=>f.id)).toEqual([withheld.id,sibling.id]);expect(JSON.stringify(parts.body)).toContain(withheld.id);
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});
