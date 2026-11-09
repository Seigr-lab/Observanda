import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {MediaStore} from '../../src/media.js';
import {contentBuffer} from '../../src/file-content.js';
import {createFigure} from '../../src/web/figure-model.js';
import {defaultPublicationPrivacy} from '../../src/web/record-publication-privacy.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test.use({screenshot:'off',trace:'off',video:'off'});
const action=(page,key)=>page.locator('[data-action="website-files-'+key+'"]');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const galleryPage='atlas/plates.html';
const sampleImage=color=>Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="'+color+'"/><path d="M20 867h150" stroke="white" stroke-width="8"/></svg>');
function makePlot(title){
 const plot=createFigure();plot.title=title;
 plot.series[0].points=[{x:1,y:2,error:null},{x:2,y:5,error:null}];return plot;
}

async function prepare(directory){
 const book=sampleNotebook(),[first,second]=book.entries;
 book.entries=[first,second];first.title='Marsh microscopy';second.title='Conductivity profiles';
 first.body='Withheld specimen location';first.share=second.share=false;
 first.publication=defaultPublicationPrivacy();first.publication.website.body=false;
 first.figures=[makePlot('Particle count by tide'),makePlot('Unused calibration trace'),makePlot('Private calibration trace')];
 first.publication.website.hiddenFigures=[first.figures[2].id];
 second.figures=[makePlot('Salinity by depth')];
 const fixture=await encryptedFixture(directory,book),media=new MediaStore(fixture.workspace);
 const current=await fixture.workspace.read(),photos=[];
 for(const [caption,color,share] of [['Diatom frustule','blue',true],['Reserve slide','green',true],['Private specimen','red',false]]){
  const asset=await media.import(sampleImage(color),'image');
  photos.push({...asset,caption,alt:caption,transcript:'',share});
 }
 current.book.entries.find(row=>row.id===first.id).attachments=photos;
 await fixture.workspace.save(current.book,current.etag);
 const siteId=randomUUID(),files=new WebsiteFileStore(fixture.workspace);
 const page=title=>'<!doctype html><html><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1></main></body></html>';
 await files.importFiles(siteId,{name:'Estuary atlas',files:new Map([['index.html',page('Estuary atlas')],[galleryPage,page('Microscopy plates')],['style.css','']]),
  draftFiles:new Map([['draft/slides.html',page('Draft slides')],['draft-styles.css','']])});
 return {...fixture,first,second,photos,siteId};
}

async function updateGrant(page,app,record,photo=null,visible=true){
 await page.goto(app.origin+'/#/records/'+record.id+'/read');
 await page.getByRole('button',{name:'Edit record',exact:true}).click();
 const field=photo?'media:'+photo.id:'share',dialog=page.getByRole('dialog');
 if(photo)await page.locator('details[data-disclosure="record-evidence"]:not([open]) > summary').click();
 await page.locator('[data-action="record-value-edit"][data-value-field="'+field+'"]').click();
 if(photo)await dialog.locator('[data-media-detail="share"]').setChecked(visible);
 else await dialog.locator('[data-record-value]').selectOption(String(visible));
 await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
}

async function chooseSource(page,title){
 await action(page,'picker-open').click();
 const picker=page.locator('dialog[data-website-picker-dialog]');
 await picker.getByRole('button',{name:title,exact:true}).click();
 await action(picker,'picker-gallery').click();
 await expect(page.locator('.website-source-gallery h4')).toHaveText(title);
 return page.locator('.website-figure-choices li');
}

async function gallery(page,name,selections){
 await action(page,'galleries').click();await action(page,'figures-new').click();
 const previews=[];
 for(const [title,labels] of selections){
  const choices=await chooseSource(page,title);
  await expect(choices.filter({hasText:/Private specimen|Private calibration trace/})).toHaveCount(0);
  if(title==='Marsh microscopy')await expect(choices.filter({hasText:'Unused calibration trace'})).toHaveCount(1);
  for(const label of labels){
   const row=choices.filter({hasText:label});
   const thumbnail=row.locator('img');
   const size=await thumbnail.evaluate(async img=>{await img.decode();return img.naturalWidth;});expect(size).toBeGreaterThan(0);
   const url=await thumbnail.getAttribute('src');
   const type=await page.evaluate(async src=>(await fetch(src)).headers.get('content-type'),url);
   expect(type).toContain(url.includes('figure%3A')?'image/svg+xml':'image/png');
   previews.push(url);
   await action(row,'figures-add').click();
  }
 }
 await page.locator('[data-figure-heading]').fill(name);await action(page,'figures-apply').click();
 await expect(page.frameLocator('#website-files-canvas').getByRole('heading',{name,exact:true})).toBeVisible();
 return previews;
}

async function reopenGallery(page,name){
 await action(page,'galleries').click();await action(page,'figures-edit').filter({hasText:name}).click();
 return page.locator('.website-figure-order li');
}

async function publish(page,directory){
 await action(page,'folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(directory);
 await page.getByRole('button',{name:'Review file changes',exact:true}).click();
 await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files',exact:true}).click();
 await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
}

// A fresh server and browser session for each passage. Only the disposable
// research fixture uses the configured native PostgreSQL URL. The editor is
// given an unreachable local database and all its HTTP requests are checked.
async function session(browser,fixture,directory,website,run){
 const database=process.env.OBSERVANDA_DATABASE_URL;
 let app,context,page;
 try{
  if(website){
   process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
   await expect(fixture.workspace.catalogue(store=>store.head())).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
  }
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  context=await browser.newContext({viewport:{width:1600,height:1000}});
  page=await context.newPage();const unexpected=[],errors=[];page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  context.on('request',request=>{
   const route=new URL(request.url()).pathname;
   if(website&&route.startsWith('/api/')&&!route.startsWith('/api/website-files/')&&!['/api/session','/api/access/status','/api/interface','/api/language'].includes(route))unexpected.push(route);
  });
  await page.goto(website?app.origin+'/?view=website#'+app.launchToken:app.url);
  if(website){
   await page.locator('[data-website-file-site]').selectOption(fixture.siteId);
   await page.locator('[data-website-file-page]').selectOption(galleryPage);
   await expect(page.frameLocator('#website-files-canvas').getByRole('heading',{name:'Microscopy plates'})).toBeVisible();
  }
  else await expect(page.locator('.topbar .workspace-name')).toBeVisible();
  await run(page,app);expect(unexpected).toEqual([]);expect(errors).toEqual([]);
 }catch(error){
  const status=await page?.locator('main').innerText({timeout:1000}).catch(()=>'');
  throw new Error(error.message+'\n'+(status??'').slice(0,1300),{cause:error});
 }finally{
  try{await context?.close();await app?.close();}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
 }
}

async function publicSite(directory){
 const server=createServer(async(request,response)=>{
  const file=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html';
  if(file!==galleryPage&&!/^(?:index\.html|[\w-]+\.(?:css|js)|(?:pictures|assets)\/[\w-]+\.(?:png|svg))$/.test(file)){response.writeHead(404).end();return;}
  try{const bytes=await readFile(path.join(directory,file));
   const mime={'.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.css':'text/css','.js':'application/javascript'};
   response.writeHead(200,{'Content-Type':mime[path.extname(file)]}).end(bytes);
  }catch{response.writeHead(404).end();}
 });
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('a published scientific gallery tracks selected lab figures, scoped photographs, withdrawal and regrant while its editor runs offline',async({browser})=>{
 test.setTimeout(360000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-estuary-gallery-')),output=path.join(directory,'published');
 let fixture,staticSite,publicPage;
 try{
  await mkdir(output);fixture=await prepare(directory);
  const {first,second,photos}=fixture,lab=run=>session(browser,fixture,directory,false,run),web=run=>session(browser,fixture,directory,true,run);
  const photo=photos[0],galleryName='Microscopy and salinity',alt='Engraved frustule in microscopy plate',caption='Atlas plate with local annotation';
  const evidence=new MediaStore(fixture.workspace),originalBytes=sampleImage('blue');
  const originalEvidence=async()=>contentBuffer(await evidence.originalContent(photo.id),{maxBytes:originalBytes.length});
  expect(await originalEvidence()).toEqual(originalBytes);
  await lab(async(page,app)=>{await updateGrant(page,app,first);await updateGrant(page,app,second);});
  let photoURL,assetName,photoAssets;
  const imageNames=page=>page.locator('[data-website-source-gallery] img').evaluateAll(images=>images.map(image=>image.alt));
  await web(async page=>{
   await page.locator('[data-website-file-page]').selectOption('draft/slides.html');
   await gallery(page,'Draft reserve slides',[[first.title,['Reserve slide']]]);
   await page.locator('[data-website-file-page]').selectOption(galleryPage);
   await action(page,'galleries').click();
   await page.locator('[data-gallery-files]').setInputFiles(path.resolve('src/preview-assets/image.png'));
   await page.locator('[data-gallery-field="alt"]').fill('Authored field map');await action(page,'save').click();
   await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
   await action(page,'gallery-close').click();
   [photoURL]=await gallery(page,galleryName,[[first.title,['Diatom frustule','Particle count by tide']],[second.title,['Salinity by depth']]]);
   await page.reload();await page.locator('[data-website-file-page]').selectOption(galleryPage);const canvas=page.frameLocator('#website-files-canvas');
   await expect(canvas.locator('[data-website-source-gallery] img')).toHaveCount(3);
   const firstSlot=(await reopenGallery(page,galleryName)).first();
   await firstSlot.locator('details summary').first().click();await firstSlot.locator('[data-figure-text="alt"]').fill(alt);
   await firstSlot.getByText('Frame image',{exact:true}).click();
   const ratio=firstSlot.getByLabel('Aspect ratio'),thumbnail=firstSlot.locator('img').first();
   await ratio.selectOption('square');await expect(thumbnail).toHaveCSS('aspect-ratio','1 / 1');
   await ratio.selectOption('original');await expect(thumbnail).toHaveCSS('aspect-ratio','auto');
   await ratio.selectOption('square');await firstSlot.getByLabel('Fit',{exact:true}).selectOption('cover');
   const focus=firstSlot.getByLabel('Horizontal focus');await focus.press('End');for(let i=0;i<5;i++)await focus.press('ArrowLeft');
   await firstSlot.getByRole('button',{name:'View full-resolution image'}).click();
   const original=page.getByRole('dialog',{name:'View full-resolution image'}).locator('img');
   expect(await original.evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight];})).toEqual([1600,900]);await page.keyboard.press('Escape');
   await firstSlot.locator('[data-figure-text="caption"]').fill(caption);await action(page,'figures-apply').click();
   await expect(canvas.getByRole('img',{name:alt,exact:true})).toBeVisible();await expect(canvas.getByText(caption,{exact:true})).toBeVisible();
   await action(page,'preview').click();const preview=page.frameLocator('#website-files-preview');
   await expect(preview.getByRole('heading',{name:galleryName})).toBeVisible();await expect(preview.getByRole('img',{name:'Authored field map'})).toBeVisible();
   await publish(page,output);
  });
  staticSite=await publicSite(output);publicPage=await browser.newPage();await publicPage.goto(staticSite.url+'/'+galleryPage);
  const publicFigures=publicPage.locator('[data-website-source-gallery] figure');
  await expect(publicFigures).toHaveCount(3);const names=await imageNames(publicPage);
  expect(names[0]).toBe(alt);expect(names[1]).toContain('Particle count by tide');expect(names[2]).toContain('Salinity by depth');
  const links=await publicFigures.locator('img').evaluateAll(images=>images.map(img=>new URL(img.src).pathname.slice(1)));
  for(const name of links){const bytes=await readFile(path.join(output,name));expect(name).toContain(digest(bytes));}
  assetName=links[0];
  expect(await readFile(path.join(output,assetName))).toEqual((await evidence.get(photo.id)).bytes);
  const publishedPhoto=publicFigures.first().locator('img');await expect(publishedPhoto).toHaveCSS('object-fit','cover');await expect(publishedPhoto).toHaveCSS('object-position','75% 50%');
  const candidates=await publishedPhoto.evaluate(img=>img.srcset.split(',').map(token=>{const [url,width]=token.trim().split(/\s+/);return {name:new URL(url,document.baseURI).pathname.slice(1),width:Number.parseInt(width)};}));
  photoAssets=candidates.map(c=>c.name);expect(candidates.map(c=>c.width)).toEqual([320,640,960,1440,1600]);expect(photoAssets.at(-1)).toBe(assetName);
  expect((await readdir(path.join(output,'assets'))).sort()).toEqual([...new Set([...links,...photoAssets])].map(name=>path.basename(name)).sort());
  const selections=[];
  for(const width of [800,1540])for(const deviceScaleFactor of [1,2]){
   const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor}),reader=await context.newPage(),requests=[];
   try{
    context.on('request',request=>requests.push(new URL(request.url())));
    await reader.goto(staticSite.url+'/'+galleryPage);const image=reader.locator('[data-website-source-gallery] img').first();
    const current=await image.evaluate(async img=>{await img.decode();return new URL(img.currentSrc).pathname.slice(1);});
    expect(photoAssets).toContain(current);expect(requests.every(url=>url.origin===staticSite.url)).toBe(true);selections.push(current);
   }finally{await context.close();}
  }
  expect(selections[0]).not.toBe(assetName);expect(new Set(selections).size).toBeGreaterThan(1);
  expect((await readFile(path.join(output,selections[0]))).length).toBeLessThan((await readFile(path.join(output,assetName))).length);
  expect(await publicPage.locator('img').evaluateAll(images=>Promise.all(images.map(async img=>{await img.decode();return img.naturalWidth>0;})))).not.toContain(false);
  expect(await readFile(path.join(output,galleryPage),'utf8')).not.toMatch(/Reserve slide|Private specimen|Withheld specimen location|(?:Unused|Private) calibration trace/);
  await expect(readFile(path.join(output,'draft','slides.html'))).rejects.toMatchObject({code:'ENOENT'});
  await lab((page,app)=>updateGrant(page,app,first,photo,false));
  await web(async page=>{
   await expect(page.frameLocator('#website-files-canvas').locator('[data-website-source-gallery] figure')).toHaveCount(2);
   expect(await page.evaluate(async url=>(await fetch(url)).status,photoURL)).toBeGreaterThanOrEqual(400);
   const slots=await reopenGallery(page,galleryName);await expect(slots).toHaveCount(3);
   await expect(slots.first().locator('.website-gallery-withheld')).toBeVisible();
   await expect(slots.first().locator('img,a,[data-figure-text]')).toHaveCount(0);
   await expect(slots.first()).not.toContainText(/Diatom frustule|Atlas plate|Engraved frustule/);await action(page,'figures-close').click();
   await publish(page,output);
  });
  await publicPage.reload();await expect(publicFigures).toHaveCount(2);expect(await imageNames(publicPage)).toEqual(names.slice(1));
  for(const retired of photoAssets)await expect(readFile(path.join(output,retired))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(path.join(output,galleryPage),'utf8')).not.toMatch(/Diatom frustule|Atlas plate|Engraved frustule/);
  await lab((page,app)=>updateGrant(page,app,first,photo,true));
  await web(async page=>{await expect(page.frameLocator('#website-files-canvas').locator('[data-website-source-gallery] figure')).toHaveCount(3);await publish(page,output);});
  await publicPage.reload();await expect(publicFigures).toHaveCount(3);expect(await imageNames(publicPage)).toEqual([photo.alt,...names.slice(1)]);
  expect(await publicFigures.first().locator('figcaption').innerText()).toContain(photo.caption);
  expect(await readFile(path.join(output,galleryPage),'utf8')).not.toMatch(/Atlas plate|Engraved frustule/);
  expect(assetName).toContain(digest(await readFile(path.join(output,assetName))));
  expect(await originalEvidence()).toEqual(originalBytes);
 }finally{
  await publicPage?.close();await staticSite?.close();if(fixture)await clearVault(fixture.vault);
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-estuary-gallery-'))throw Error('Unexpected temporary gallery directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
 }
});
