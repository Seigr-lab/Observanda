import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {retainedTable} from '../../src/retained-tables.js';
import {defaultColumn} from '../../src/web/dataset-schema.js';
import {defaultPublicationPrivacy} from '../../src/web/record-publication-privacy.js';
import {convertPublicationRecord} from '../../src/publication-conversion-render.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

const authored='<table id="chem"><caption>Calibration by station</caption><colgroup span="1"></colgroup><colgroup span="2"></colgroup><thead><tr><th rowspan="2" scope="col">Station</th><th colspan="2" scope="colgroup" id="group">Chemistry</th></tr><tr><th scope="col" id="acid">Acidity (mol dm<sup>−3</sup>)</th><th scope="col" id="ph">pH</th></tr></thead><tbody><tr><th scope="row">A</th><td headers="group acid">0.1000000000000000002</td><td headers="group ph">6.00<sup><a href="#limit">a</a></sup></td></tr><tr><th scope="row">B</th><td headers="group acid">0.2000</td><td headers="group ph">7.00</td></tr></tbody></table><p id="limit">a · Calibration drift.</p>';

async function publish(page,output){
 await page.getByRole('button',{name:'Publish to folder',exact:true}).click();
 await page.getByLabel('Destination folder',{exact:true}).fill(output);
 await page.getByRole('button',{name:'Review file changes'}).click();
 await page.locator('[data-website-file-folder-confirm]').check();
 await page.getByRole('button',{name:'Write reviewed files'}).click();
 await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
}
async function pasteAt(cell,text){
 await cell.click();await cell.evaluate((node,value)=>{
  const range=node.ownerDocument.createRange();range.selectNodeContents(node);range.collapse(true);
  const selection=node.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);
  const data=new DataTransfer();data.setData('text/plain',value);
  node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },text);
}
test('edit and publish a grouped laboratory table alongside one permitted retained result, then withdraw that result',async({browser,page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-table-author-')),output=path.join(directory,'public'),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,reader;
 try{
  await mkdir(output);fixture=await encryptedFixture(directory,sampleNotebook());const book=(await fixture.workspace.read()).book;
  const record={...book.entries[0],share:true,title:'Calibration experiment',publication:defaultPublicationPrivacy(),sections:[],figures:[],attachments:[],relations:[]};
  const notebook=book.notebooks.find(b=>b.id===record.notebookId),provenance={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:record.id};
  const materials=new ResearchMaterials(fixture.workspace),sourceId=websiteSourceId(provenance),store=new WebsiteFileStore(fixture.workspace),siteId=randomUUID();
  const exact='0.03125000000000000000007',csv=Buffer.from('Station,Measured,pin\nAlpha,'+exact+',never-share-this-value');
  const upload=await materials.startImport({recordId:record.id,name:'measurements.csv',size:csv.length});
  await materials.appendImport(upload.id,0,[csv]);
  const ref=await materials.dataset({recordId:record.id,title:'Source observations',artifact:await materials.finishImport(upload.id),columns:['Station','Measured','pin'].map(label=>defaultColumn({label}))});
  const selected=await retainedTable(materials,{ref,selection:{columns:[0,1],offset:0,count:1,includeExcluded:false},version:3});
  const result=randomUUID();record.results={version:1,statements:[{id:result,kind:'table',title:'Observed concentration',text:'Approved measurements',basis:'retained',source:ref,table:selected,limitations:'One station'}]};
  async function project(){
   const converted=await convertPublicationRecord(fixture.workspace,book,record);
   const token=await store.beginSourceUpdate({sourceId,target:'website'});
   return store.putSource({sourceId,provenance,title:record.title,...converted},{token});
  }
  const source=await project(),html='<!doctype html><html lang="en"><head><title>Calibration atlas</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Calibration atlas</h1>'+authored+'</main></body></html>';
  const opened=await store.importFiles(siteId,{name:'Calibration atlas',files:new Map([['index.html',html],['style.css','table{border-collapse:collapse}']])});
  await store.insertSource(siteId,{path:'index.html',expectedRevision:opened.site.revision,sourceId,sourceRevision:source.revision});
  async function offline(){
   process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
   await expect(fixture.workspace.catalogue(db=>db.head())).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
   app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
   await page.goto(app.origin+'/?view=website#'+app.launchToken);
  }
  await offline();
  const frame=page.frameLocator('#website-files-canvas'),table=frame.locator('#chem'),controls=page.getByRole('group',{name:'Edit table'}),act=key=>controls.locator('[data-table-action="'+key+'"]');
  await table.locator('#acid').click();await controls.getByText('Structure and groups',{exact:true}).click();
  await controls.getByLabel('Columns in selection').fill('2');await act('tableMerge').click();
  await expect(table.locator('th#acid')).toHaveAttribute('colspan','2');await expect(table.locator('#acid sup')).toHaveText('−3');
  await expect(table.locator('tbody td').nth(1)).toHaveAttribute('headers','group acid');
  await act('tableSplit').click();await expect(table.locator('thead tr').last().locator('th')).toHaveCount(2);
  await table.locator('thead tr').last().locator('th').last().click();await controls.getByLabel('Cell text or number').fill('pH reading');await act('tableApply').click();
  await table.locator('tbody td').nth(1).click();await controls.getByText('Header associations',{exact:true}).click();
  await controls.getByLabel('Find a header').fill('pH reading');await act('tableAssociate').click();
  const header=await table.locator('thead tr').last().locator('th').last().getAttribute('id');
  expect(header).toBeTruthy();await expect(table.locator('tbody td').nth(1)).toHaveAttribute('headers','group acid '+header);
  await controls.getByRole('button',{name:/Remove association · Acidity/}).click();
  await expect(table.locator('tbody td').nth(1)).toHaveAttribute('headers','group '+header);
  await act('tableMoveRowDown').click();await expect(table.locator('tbody tr').last().getByRole('rowheader')).toHaveText('A');
  await act('tableRowAfter').click();const added=table.locator('tbody tr').last();
  await pasteAt(added.locator('th'),'C\t1.25000000000000000003\t6.7500');
  await expect(added.locator('td')).toHaveText(['1.25000000000000000003','6.7500']);
  await act('tableScrollOn').click();await expect(frame.locator('[role="region"][aria-label="Calibration by station"]')).toBeVisible();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.locator('[data-action="website-files-presentation"]:not([data-placement-context])').click();
  const dialog=page.locator('dialog[data-website-presentation]');await dialog.getByRole('radio',{name:'Section or results table'}).check();
  await dialog.getByLabel('Content to show').selectOption('table:'+result);await dialog.locator('[data-presentation-apply]').click();
  const linked=frame.locator('[data-observanda-display="section"] table');
  await expect(linked.locator('tbody')).toContainText(exact);await linked.locator('td').first().click();await expect(controls).toBeHidden();
  await page.reload();await expect(frame.locator('#chem thead sup')).toHaveText('−3');
  await publish(page,output);reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(output,'index.html')).href);
  await expect(reader.locator('table')).toHaveCount(2);await expect(reader.locator('#chem tbody tr').nth(1).locator('sup a')).toHaveAttribute('href','#limit');
  await expect(reader.locator('#chem tbody tr').last().locator('td')).toHaveText(['1.25000000000000000003','6.7500']);
  let files=await readFile(path.join(output,'index.html'),'utf8');expect(files).toContain(exact);expect(files).not.toContain('never-share-this-value');
  expect(files).not.toContain('data-retained-ref');await app.close();app=null;process.env.OBSERVANDA_DATABASE_URL=database;
  record.publication.website.results=false;await project();await offline();
  await expect(frame.locator('#chem')).toBeVisible();await expect(linked).toHaveCount(0);await publish(page,output);
  await reader.reload();await expect(reader.locator('table')).toHaveCount(1);files=await readFile(path.join(output,'index.html'),'utf8');
  expect(files).not.toContain(exact);expect(files).not.toContain('Observed concentration');expect(files).toContain('1.25000000000000000003');
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  try{await reader?.close();await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});
