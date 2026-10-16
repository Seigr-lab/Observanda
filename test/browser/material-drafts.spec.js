import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {test,expect} from '@playwright/test';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';

test('unfinished selections survive lost replies and reload, and completion attaches each pinned source once',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-draft-ui-'));
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,sampleNotebook());
 const owner=(await ws.read()).book.entries[0].id,materials=new ResearchMaterials(ws);
 await ws.withLock(async()=>{for(let i=0;i<70;i++)await materials.commit({kind:'collection',recordId:owner,title:'Take '+String(i).padStart(2,'0'),content:{inputs:[]}});});
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,owner);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  const dialog=page.locator('#dialog');
  await dialog.getByText('Analysis, collections & verification',{exact:true}).click();
  await dialog.getByRole('button',{name:'Create collection',exact:true}).click();
  await dialog.getByLabel('Title',{exact:true}).fill('Listening session');
  const picker=dialog.locator('#material-picker-inputs');
  const expected=[];
  for(const count of [20,20,20,10]){
   await expect(picker.getByRole('checkbox')).toHaveCount(count);
   for(const box of await picker.getByRole('checkbox').all()){
    const [kind,id,revision]=(await box.inputValue()).split(':');expected.push({kind,id,revision});
    await box.check();await expect(picker).not.toHaveAttribute('aria-busy','true');
   }
   if(count===20){await picker.getByRole('button',{name:'More sources',exact:true}).click();await expect(picker).not.toHaveAttribute('aria-busy','true');}
  }
  await expect(picker.locator('[data-selection]')).toContainText('70 selected');
  await expect(picker.locator('[data-selection] li')).toHaveCount(10);
  await picker.locator('[data-selection] summary').click();
  await picker.getByRole('button',{name:'More selected sources',exact:true}).focus();await page.keyboard.press('Enter');
  expect((await picker.locator('[data-value]').inputValue()).length).toBeLessThan(1500);
  let lostBatch=false;
  await page.route('**/api/research/materials/draft-append',async route=>{
   if(!lostBatch){lostBatch=true;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await dialog.getByRole('button',{name:'Save collection',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Unfinished collection',exact:true})).toBeVisible();
  await expect(dialog).toContainText('64 of 70 received');
  await expect(dialog.getByRole('button',{name:'Complete collection',exact:true})).toBeDisabled();
  const drafts=await materials.drafts.list(owner),draft=drafts.items[0];expect(drafts.items).toHaveLength(1);
  expect(await materials.current(draft.id)).toBeNull();
  // Closing the browser state loses the unsent selection but never calls it complete.
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Continue Listening session',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Retry saving selection',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Next inputs',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog.locator('#material-draft-inputs')).toContainText('21–40');
  await dialog.getByRole('button',{name:'Choose remaining inputs',exact:true}).click();
  const remaining=dialog.locator('#material-picker-remaining');
  for(const reference of expected.slice(64)){
   const doc=await materials.read(reference);
   await remaining.getByLabel('Search remaining inputs').fill(doc.title);await remaining.getByLabel('Search remaining inputs').press('Enter');await expect(remaining).not.toHaveAttribute('aria-busy','true');
   await expect(remaining.getByRole('checkbox')).toHaveCount(1);await remaining.getByRole('checkbox').check();
  }
  await dialog.getByRole('button',{name:'Save selected inputs',exact:true}).click();
  await expect(dialog).toContainText('70 of 70 received');
  await expect(dialog.getByRole('button',{name:'Complete collection',exact:true})).toBeEnabled();
  await expect(dialog.locator('#material-draft-inputs li')).toHaveCount(20);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='150%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
  for(const element of [dialog,dialog.getByRole('heading',{name:'Unfinished collection',exact:true}),dialog.getByRole('button',{name:'Complete collection',exact:true}),dialog.getByRole('button',{name:'Back to evidence',exact:true})]){
   const box=await element.boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(844);
  }
  await page.screenshot({path:test.info().outputPath('unfinished-collection-phone.png')});
  let lostFinish=false;
  await page.route('**/api/research/materials/draft-finish',async route=>{
   if(!lostFinish){lostFinish=true;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await dialog.getByRole('button',{name:'Complete collection',exact:true}).click();
  await expect(dialog.locator('#material-draft-status')).toContainText('Completion could not be confirmed');
  await expect(dialog.getByRole('button',{name:'Complete collection',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Complete collection',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:20000});
  expect((await materials.drafts.list(owner)).items).toEqual([]);
  const result=(await materials.list({recordId:owner,query:'Listening session'})).items;expect(result).toHaveLength(1);
  const saved=[];for await(const ref of materials.references((await materials.read(result[0])).content))saved.push(ref);
  expect(saved).toEqual(expected);
  await dialog.locator('.material-list > li').filter({has:page.getByText('Listening session',{exact:true})}).getByRole('button',{name:'Inspect',exact:true}).click();
  await expect(dialog.locator('#material-input-references li')).toHaveCount(20);
  await dialog.getByRole('button',{name:'Next inputs',exact:true}).click();
  await expect(dialog.locator('#material-input-references')).toContainText('21–40');
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});

test('external analysis saves exact input and output pages and preserves its tool and procedure',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-external-analysis-ui-'));
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,sampleNotebook());
 const owner=(await ws.read()).book.entries[0].id,materials=new ResearchMaterials(ws);
 const input=await materials.collection({recordId:owner,title:'Session evidence',inputs:[]});
 const session=await materials.startImport({recordId:owner,name:'spectrum.json',size:2});
 await materials.appendImport(session.id,0,[Buffer.from('{}')]);const output=await materials.finishImport(session.id);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,owner);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();const dialog=page.locator('#dialog');
  await dialog.getByText('Analysis, collections & verification',{exact:true}).click();
  await dialog.getByRole('button',{name:'Record external analysis',exact:true}).click();
  await dialog.getByLabel('Title',{exact:true}).fill('Compare recorded takes');
  await dialog.locator('#material-picker-inputs').getByRole('checkbox',{name:/Session evidence/}).check();
  await dialog.getByLabel('Tool / method',{exact:true}).fill('Independent spectrum tool');
  await dialog.getByLabel('Tool version or source revision',{exact:true}).fill('commit abc123');
  await dialog.getByLabel('Parameters and procedure',{exact:true}).fill('Window 4096; each take kept separate.');
  await dialog.locator('#material-picker-outputs').getByRole('checkbox',{name:/spectrum.json/}).check();
  await page.route('**/api/research/materials/draft-append',async route=>{
   if(route.request().postDataJSON().slot==='outputs'){await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await dialog.getByLabel('Unrecorded identities and why they are unavailable').fill('Manual procedure; no executable tool source.');await dialog.getByLabel('Uncertainty convention / unknown uncertainty').fill('Not quantified.');await dialog.getByLabel('Sources, scope and limitations').fill('Fixture observations only.');await dialog.getByRole('button',{name:'Save analysis',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Unfinished analysis',exact:true})).toBeVisible();
  await expect(dialog.locator('#material-draft-status')).toContainText('Failed to fetch');
  await dialog.getByText('Analysis method',{exact:true}).click();
  await expect(dialog).toContainText('commit abc123');
  await expect(dialog).toContainText('Window 4096; each take kept separate.');
  await dialog.getByRole('button',{name:'Complete analysis',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:20000});
  await dialog.locator('.material-list > li').filter({hasText:'Compare recorded takes'}).getByRole('button',{name:'Inspect',exact:true}).click();
  await expect(dialog).toContainText('Independent spectrum tool');
  await expect(dialog).toContainText('Window 4096; each take kept separate.');
  await expect(dialog.locator('#material-input-references')).toContainText('Session evidence');
  await expect(dialog.locator('#material-output-references')).toContainText('spectrum.json');
  const result=(await materials.list({recordId:owner,kind:'analysis'})).items[0];
  const refs=async slot=>(await materials.referencePage(result,{slot})).items.map(({kind,id,revision})=>({kind,id,revision}));
  expect(await refs('inputs')).toEqual([input]);expect(await refs('outputs')).toEqual([output]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});
