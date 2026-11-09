import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {createNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('a reordered stable section, repeated unkeyed wording, CSS fallbacks and governed resource links preserve independent edits',async({page})=>{
 await page.exposeFunction('filesAPI',()=>({workspaceId:randomUUID(),title:'Lab',sites:[],preparation:{state:'ready'}}));
 await mountFilesEditor(page);
 const actual=await page.evaluate(async()=>{
  const {websiteConflictReview}=await import('/website-files-conflicts.js');
  const pageOf=(body,css='',protectedFiles=[])=>({site:{id:'demo',cssPath:'styles/theme.css',revision:'a'.repeat(64)},path:'methods/index.html',protectedFiles,html:'<!doctype html><html><body><main>'+body+'</main></body></html>',css});
  const keyed=(id,value)=>'<p data-section-id="'+id+'">'+value+'</p>';
  const source=pageOf(keyed('a','First')+keyed('b','Second'));
  const reordered=websiteConflictReview(source,pageOf(keyed('b','Second')+keyed('a','First')),pageOf(keyed('a','Revised')+keyed('b','Second')));
  const base=pageOf('<p>Label</p><p>Label</p><p id="unrelated">Before</p>');
  const repeated=websiteConflictReview(base,pageOf(base.html.match(/<main>(.*)<\/main>/)[1].replace('Label','Mine')),pageOf('<p>Label</p><p>Peer</p><p id="unrelated">After</p>'));
  const repeatedRows=repeated.rows.map(r=>r.kind);repeated.rows.forEach((_,i)=>repeated.select(i,'local'));
  const duplicateStyle='@media (min-width:40em){p{color:red;color:navy;}b{opacity:1;}}',cssBase=pageOf('',duplicateStyle);
  const styles=websiteConflictReview(cssBase,pageOf('',duplicateStyle.replace('color:navy','color:blue')),pageOf('',duplicateStyle.replace('color:navy','color:purple').replace('opacity:1','opacity:.5')));
  styles.rows.forEach((_,i)=>styles.select(i,'local'));
  const asset='assets/measurement.png',link='<a href="../'+asset+'">Retired figure</a>',oldCSS='p{background:url(../'+asset+');color:blue;}';
  const old=pageOf(link+keyed('s','Field'),oldCSS,[asset]),mine=pageOf(link+keyed('s','My field'),oldCSS.replace('color:blue','color:navy'),[asset]);
  const safe=websiteConflictReview(old,mine,pageOf(keyed('s','New field'),'p{color:blue;}'));
  const display=JSON.stringify(safe.rows);safe.rows.forEach((_,i)=>safe.select(i,'local'));
  const paragraphs=Array.from({length:3000},(_,i)=>keyed('plot-'+i,'Plot '+i)).join('');
  const heavy=websiteConflictReview(pageOf(paragraphs),pageOf(paragraphs.replace('>Plot 10<','>My reading<')),pageOf(paragraphs.replace('>Plot 2998<','>Peer reading<')));
  const report=heavy.result().html,measured={count:new DOMParser().parseFromString(report,'text/html').querySelectorAll('p').length,combined:report.includes('My reading')&&report.includes('Peer reading'),conflicts:heavy.rows.length};
  return {reordered:reordered.result(),repeated:repeated.result(),repeatedRows,css:styles.result().css,protected:safe.result(),display,measured};
 });
 expect(actual.reordered.html).toMatch(/Second.*Revised/s);
 expect(actual.repeatedRows).toContain('structure');expect(actual.repeated.html).toContain('Mine');expect(actual.repeated.html).toContain('After');
 expect(actual.css).toBe('@media (min-width:40em){p{color:red;color:blue;}b{opacity:.5;}}');
 expect(actual.protected.html).toContain('My field');expect(actual.protected.css).toContain('color:navy');
 expect(actual.measured).toEqual({count:3000,combined:true,conflicts:0});
 for(const s of [actual.display,actual.protected.html,actual.protected.css])expect(s).not.toMatch(/Retired figure|measurement\.png/);
});

test('concurrent website authors resolve individual changes against current grants and undo only their contribution, with research offline',async({page})=>{
 test.setTimeout(100000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-concurrency-')),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app;
 try{
  fixture=await encryptedFixture(root,createNotebook('Field journal'));
  const store=new WebsiteFileStore(fixture.workspace,{actor:{kind:'device',label:'Coastal author'}}),id=randomUUID();
  const owner={workspaceId:fixture.vault.id,notebookId:randomUUID(),recordId:randomUUID()},sourceId=websiteSourceId(owner);
  const put=async visible=>store.putSource({sourceId,title:'Field measurement',provenance:owner,visible,html:visible?'<p data-observanda-part="body">Temporary measurement</p>':''},{token:await store.beginSourceUpdate({sourceId})});
  const grant=await put(true);
  const html='<!doctype html><html><head><title>Field report</title><link rel="stylesheet" href="style.css"></head><body><main><p>First paragraph</p><p>Second paragraph</p><p id="finding">Observations</p></main></body></html>';
  let saved=await store.create({id,name:'Field report',html,css:'p{color:navy;margin:1em;}#finding{font-weight:500;}'});
  saved=await store.insertSources(id,{expectedRevision:saved.site.revision,sources:[{sourceId,sourceRevision:grant.revision}]});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=name=>page.getByRole('button',{name,exact:true}),input=kind=>page.locator('[data-website-file-code="'+kind+'"]');
  const edit=async(kind,replacements)=>{
   await button(kind.toUpperCase()).click();
   const field=input(kind);let text=await field.inputValue();
   for(const [a,b] of replacements){expect(text).toContain(a);text=text.replace(a,b);}
   await field.fill(text);
  };
  const remote=async(html,css)=>{
   const latest=await store.open(id);
   return store.save(id,{expectedRevision:latest.site.revision,path:latest.path,html:html(latest.html),css:css(latest.css)});
  };
  const saves=[];page.on('request',req=>{if(new URL(req.url()).pathname==='/api/website-files/save')saves.push(req.postDataJSON());});
  await edit('html',[['First paragraph','First author']]);
  await remote(text=>text.replace('Second paragraph','Second author'),text=>text);
  await expect(input('html')).toHaveValue(/Second author/,{timeout:10000});
  await expect(input('html')).toHaveValue(/First author/);
  await button('Save website').click();await expect(page.locator('[data-website-files-status]')).toContainText('Website saved.');
  expect((await store.open(id)).html).toMatch(/First author.*Second author/s);
  await edit('html',[['Observations','Local findings']]);
  await edit('css',[['color:navy','color:blue'],['margin:1em','margin:2em']]);
  await remote(text=>text.replace('Observations','Peer findings'),text=>text.replace('color:navy','color:green').replace('font-weight:500','font-weight:600'));
  const review=page.locator('.website-merge-panel'),apply=button('Save resolved page'),local=button('Use my change'),peer=button('Use saved change');
  await expect(review).toContainText('Coastal author',{timeout:10000});await expect(review).toContainText('2 unresolved of 2');
  await expect(review.getByRole('region',{name:'Before either edit'})).toContainText('Observations');await expect(apply).toBeDisabled();
  await local.click();await expect(review).toContainText('1 unresolved of 2');
  await remote(text=>text.replace('Peer findings','Revised peer findings'),text=>text);
  await expect(review).toContainText('2 unresolved of 2',{timeout:10000});await expect(review).toContainText('Revised peer findings');
  await local.click();await put(false);
  await expect(review).toContainText('2 unresolved of 2',{timeout:10000});
  await expect(page.locator('body')).not.toContainText('Temporary measurement');
  await local.click();await review.locator('[data-action="website-files-merge-next"]').click();
  await expect(review).toContainText('color');await peer.click();
  expect(saves).toHaveLength(1);await apply.click();
  await expect(review).toHaveCount(0);await expect(page.locator('[data-website-files-status]')).toContainText('Website saved.');
  expect(saves).toHaveLength(2);const final=await store.open(id);expect(final.html).toContain('Local findings');expect(final.html).not.toContain('Temporary measurement');
  expect(final.css).toContain('color:green');expect(final.css).toContain('margin:2em');expect(final.css).toContain('font-weight:600');
  await button('Undo').click();await expect(input('css')).toHaveValue(/margin:1em/);
  await button('HTML').click();await expect(input('html')).toHaveValue(/Revised peer findings/);await expect(input('html')).not.toHaveValue(/Temporary measurement/);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 }
});
