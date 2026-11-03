import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {saveWebsiteFeed} from '../../src/website-dynamic-feeds.js';
import {websiteSourceUsage,websitesUsingSource} from '../../src/website-file-placements.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {seedWebsitePickerCorpus} from '../helpers/website-picker-corpus.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('where used finds exact feed entries across duplicate site names, host pages and generated continuations',async({page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-locations-')),book=sampleNotebook();book.entries=[];
 const database=process.env.OBSERVANDA_DATABASE_URL;let fixture,app;
 try{
  fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),{examples,books,projects}=await seedWebsitePickerCorpus(store,{count:3}),desk=(await store.create({name:'Library desk'})).site.id;
  const compact=randomUUID(),split=randomUUID(),html='<!doctype html><html><head><title>Survey</title></head><body><main><h1>Survey</h1></main></body></html>';
  const make=async(id,path,pageSize)=>{
   const opened=await store.open(id);
   return saveWebsiteFeed(store,id,{expectedRevision:opened.site.revision,path,feedId:null,heading:'Duplicate feed name',template:'card',criteria:{},pageSize});
  };
  for(const id of [compact,split])await store.importFiles(id,{name:'Coastal atlas',files:new Map([['index.html',html],['reports.html',html],['style.css','']])});
  const one=await make(compact,'reports.html',5),two=await make(compact,'reports.html',5);
  const spread=await make(split,'reports.html',1);
  const descriptor=(await store.scope(()=>store.raw(split))).feeds.find(f=>f.id===spread.feedId),group=descriptor.groups[1],source=examples.find(e=>e.id===group.ids[0]);
  const pin={sourceId:source.id,sourceRevision:source.revision},target='feeds/'+spread.feedId+'/'+group.key+'.html';
  await store.insertSource(split,{...pin,expectedRevision:spread.site.revision,path:'reports.html'});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  await expect(fixture.workspace.catalogue(db=>db.head())).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
  // An unfinished save may have registered a site which does not actually
  // contain this entry. It must not disclose the site's name or membership.
  await store.scope(()=>store.writeControl('.observanda/website-files/sources/'+source.id+'/placements/'+desk+'.json',{sourceId:source.id,siteId:desk}),{write:true});
  const sites=[];let after=null;
  do{const batch=await websitesUsingSource(store,{...pin,after,limit:1});sites.push(...batch.items);after=batch.next;}while(after);
  expect(sites.map(s=>s.siteId).sort()).toEqual([compact,split].sort());
  expect(sites.find(s=>s.siteId===compact)).toMatchObject({total:2,pageCount:1});expect(sites.find(s=>s.siteId===split)).toMatchObject({total:2,pageCount:2});
  const revision=sites.find(s=>s.siteId===split).revision;
  const spans=await websiteSourceUsage(store,split,{...pin,expectedRevision:revision,path:'reports.html',limit:1});
  expect(spans).toMatchObject({onPage:1,total:2,next:1});expect(spans.items[0].kind).toBe('block');
  const readPageText=store.readText;
  store.readText=()=>{throw Error('Resolving a feed location opened document bodies');};
  try{
   const generated=await websiteSourceUsage(store,split,{...pin,expectedRevision:revision,offset:1,limit:1});
   expect(generated.items[0]).toMatchObject({kind:'feed',path:target,ownerPage:'reports.html',feedId:spread.feedId,editable:false});
  }finally{store.readText=readPageText;}
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  const routes=[];page.on('request',r=>{const pathname=new URL(r.url()).pathname;if(pathname==='/api/storage'||pathname.includes('/research/'))routes.push(pathname);});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const picker=page.locator('dialog[data-website-picker-dialog]'),preview=page.frameLocator('#website-files-preview');
  async function sitesForSource(){
   await page.locator('[data-website-file-site]').selectOption(desk);await page.locator('[data-action="website-files-picker-open"]').click();
   await expect(picker.getByRole('button',{name:source.title,exact:true})).toHaveCount(3);
   const row=picker.locator('[data-picker-row="'+source.id+'"]');
   await expect(row.locator('.website-picker-ancestry')).toContainText(books.find(book=>book.id===source.notebookId).title);
   await expect(row.locator('.website-picker-ancestry')).toContainText(projects.find(project=>project.id===source.projectId).title);
   await row.locator('[data-action="website-files-picker-select"]').click();
   await picker.locator('[data-action="website-files-picker-show-uses"]').click();
   await picker.locator('[data-action="website-files-picker-sites-open"]').click();
   await expect(picker.locator('.website-picker-sites tbody tr')).toHaveCount(2);
  }
  async function pickSite(id){
   await picker.locator('.website-picker-sites tbody tr').filter({hasText:id.slice(0,8)}).getByRole('button',{name:'Coastal atlas',exact:true}).click();
  }
  async function verify(row,feedId,pathname){
   await expect(row.locator('[data-action="website-files-picker-review-remove"]')).toHaveCount(0);
   await row.locator('[data-action="website-files-picker-jump"]').click();
   await expect(picker).not.toBeVisible();
   const matched=preview.locator('section[data-website-feed="'+feedId+'"] [data-website-feed-source="'+source.id+'"]');
   await expect(matched).toBeFocused();await expect(matched).toContainText(source.title);
   const url=await page.locator('#website-files-preview').getAttribute('src');expect(new URL(url).pathname.endsWith('/'+pathname)).toBe(true);
  }
  await sitesForSource();await pickSite(split);
  const generatedUse=picker.locator('.website-picker-places li').filter({hasText:target});
  await expect(generatedUse).toContainText('Feed on reports.html');await verify(generatedUse,spread.feedId,target);
  await page.locator('[data-action="website-files-visual"]').click();await sitesForSource();await pickSite(compact);
  const uses=picker.locator('.website-picker-places li');await expect(uses).toHaveCount(2);
  for(const value of [one,two])await expect(uses.filter({hasText:value.feedId.slice(0,8)})).toHaveCount(1);
  await verify(uses.filter({hasText:two.feedId.slice(0,8)}),two.feedId,'reports.html');expect(routes).toEqual([]);
  const peer=examples.find(record=>record.projectId!==source.projectId),scoped=await store.create({name:'Separate project'});
  const peerPin={sourceId:peer.id,sourceRevision:peer.revision};
  await saveWebsiteFeed(store,scoped.site.id,{path:'index.html',expectedRevision:scoped.site.revision,feedId:null,heading:'Local watershed',criteria:{projectId:peer.projectId},template:'card'});
  const token=await store.beginSourceUpdate({sourceId:source.id});
  await expect(websitesUsingSource(store,pin)).rejects.toMatchObject({code:'CONFLICT'});
  const during=await websitesUsingSource(store,peerPin);
  expect(during.items.map(row=>row.siteId)).toEqual([scoped.site.id]);
  expect((await websiteSourceUsage(store,scoped.site.id,{...peerPin,expectedRevision:during.items[0].revision})).items[0]).toMatchObject({kind:'feed',ownerPage:'index.html'});
  await store.putSource({sourceId:source.id,visible:false,title:'Withdrawn',html:'',assets:[]},{token});
  await expect(websitesUsingSource(store,pin)).rejects.toMatchObject({code:'NOT_FOUND'});
 }finally{
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-feed-locations-'))throw Error('Unexpected fixture directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
 }
});
