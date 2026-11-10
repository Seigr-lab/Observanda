import {test,expect,chromium} from '@playwright/test';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {websiteDesktopFixture} from './installed-website-app.js';
import {selectEntry,createWebsiteWorkspace,disableWebsiteResearch} from './website-workspace-fixture.js';
import {authorSite,authorScientificContent,selectLine} from './website-authoring-journey.js';

async function updateVisibility(page,{context,prefix,workspaceId,recordId,sections}){
 await page.evaluate(async({context,prefix,workspaceId,recordId,sections})=>{
  const headers={'Content-Type':'application/json','X-Observanda-Workspace':context};async function call(operation,data){const response=await fetch(prefix+'/research/records/writing/'+operation,{method:'POST',headers,body:JSON.stringify(data)}),result=await response.json();if(!response.ok)throw Error(operation+': '+result.code);return result;}
  for(const [sectionId,share] of [[sections[1],true],[sections[0],false]]){const target={workspaceId,recordId,sectionId},prior=await call('read',target);await call('save',{...target,value:{...prior.value,share},expectedRevision:prior.revision});}
 },{context,prefix,workspaceId,recordId,sections});
}

test('desktop website editing, persistence, preview and folder publication with research storage offline',async()=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_EXECUTABLE&&process.env.OBSERVANDA_QUALIFY_SOURCE_WEBSITE!=='1','Requires a packaged executable or explicit source qualification.');test.setTimeout(240000);
 const fixture=await websiteDesktopFixture(),workspace=path.resolve(fixture.directory,'Website acceptance'),output=path.resolve(fixture.directory,'published');
 let app=null,browser=null,server=null,page=null,failure=null,phase='start';const errors=[],requests=[];
 try{
  await mkdir(output);app=await fixture.start();if(!fixture.packaged)expect(await app.evaluate(({app})=>app.isPackaged)).toBe(false);page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));phase='create workspace';
  await createWebsiteWorkspace(page,fixture.directory,'Website acceptance');phase='select permitted research';const source=await selectEntry(page);phase='open file editor';await page.locator('#main-navigation').getByRole('button',{name:'Website editor',exact:true}).click();
  await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Saved HTML acceptance');await page.locator('form[data-website-files-form]').getByRole('button',{name:'New website',exact:true}).click();
  await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Saved HTML acceptance');phase='insert converted research';await page.getByRole('button',{name:'Browse available content',exact:true}).click();await page.getByRole('button',{name:'Retained observation',exact:true}).click();await page.getByRole('button',{name:'Insert selected content',exact:true}).click();
  await page.getByRole('button',{name:'Close content picker',exact:true}).click();
  const placed=page.frameLocator('#website-files-canvas').locator('[data-observanda-source]');await expect(placed).toContainText('withdraw-this-result');await expect(placed).not.toContainText('release-this-result');const placement=await placed.getAttribute('data-observanda-source');
  phase='change visibility of placed entry';await updateVisibility(page,source);await expect(placed).toContainText('release-this-result',{timeout:20000});await expect(placed).not.toContainText('withdraw-this-result');expect(await placed.getAttribute('data-observanda-source')).toBe(placement);
  phase='stop before quarantine';await fixture.close(app);app=null;

  // Every path below belongs solely to the private disposable test fixture.
  // Block the exact PostgreSQL runtime location after graceful shutdown. A file
  // at its original path also prevents startup from creating a replacement.
  const databases=await disableWebsiteResearch(fixture.directory,[workspace,...source.roots]);
  phase='open offline file editor';const coldStart=performance.now();app=await fixture.start(undefined,{website:true});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  app.context().on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))requests.push(url.pathname);});
  await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Saved HTML acceptance',{timeout:60000});
  const coldOpenMs=Math.round(performance.now()-coldStart);
  requests.push(...await page.evaluate(()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname).filter(route=>route.startsWith('/api/'))));
  await page.locator('[data-website-file-block]').selectOption('paragraph');await page.getByRole('button',{name:'Insert element',exact:true}).click();const canvas=page.frameLocator('#website-files-canvas');
  phase='type in visual editor';const paragraph=canvas.locator('main > p').last();await selectLine(page,paragraph);await page.keyboard.type('Edited with PostgreSQL offline.');await expect(paragraph).toHaveText('Edited with PostgreSQL offline.');
  phase='save visual and CSS edits';
  await page.getByRole('button',{name:'CSS',exact:true}).click();await page.getByRole('textbox',{name:'CSS',exact:true}).fill('main > p { color: rgb(21, 43, 65); }');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');await page.reload();
  await expect(page.frameLocator('#website-files-canvas').locator('main > p')).toHaveText('Edited with PostgreSQL offline.');
  phase='author a multipage site offline';await authorSite(page);
  phase='author a chemical formula, equation and reference offline';await authorScientificContent(page);
  phase='paste formatted scientific notation';
  const chemistry=canvas.locator('p').filter({has:canvas.locator('sub')});await chemistry.click();await page.keyboard.press('End');
  await chemistry.evaluate(node=>{const contents=new DataTransfer();contents.setData('text/plain',' variance σ2');contents.setData('text/html',' variance σ<sup>2</sup>');node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:contents}));});
  await expect(chemistry.locator('sup')).toHaveText('2');await page.getByRole('button',{name:'Save website',exact:true}).click();
  await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  phase='style all pages and preview typography';await page.getByRole('button',{name:'Site appearance',exact:true}).click();
  const appearance=page.getByRole('dialog',{name:'Site appearance'});await appearance.getByRole('combobox',{name:'Heading font',exact:true}).selectOption('serif');
  await expect(appearance.frameLocator('iframe').locator('h1').first()).toHaveCSS('font-family',/Georgia/);
  await appearance.getByRole('button',{name:'Apply to website'}).click();await expect(appearance).not.toBeVisible();
  phase='design the Methods folder independently';await page.locator('[data-website-file-page]').selectOption('methods/index.html');
  await page.getByRole('button',{name:'Themes',exact:true}).click();const themes=page.getByRole('dialog',{name:'Themes'});
  await themes.getByRole('combobox',{name:'Theme library',exact:true}).selectOption('');await themes.getByLabel('Theme name').fill('Instrument methods');
  await themes.getByRole('combobox',{name:'Palette',exact:true}).selectOption('night');
  await themes.getByRole('combobox',{name:'Heading font',exact:true}).selectOption('serif');await themes.getByRole('combobox',{name:'Apply to',exact:true}).selectOption('folder');
  await themes.getByRole('button',{name:'Save theme',exact:true}).click();await expect(themes).not.toBeVisible();
  await expect(canvas.locator('body')).toHaveCSS('background-color','rgb(24, 35, 44)');
  phase='edit an instrument note in split view';await page.getByRole('button',{name:'Canvas and code',exact:true}).click();
  const sourceCode=page.getByRole('textbox',{name:'HTML',exact:true}),markup=await sourceCode.inputValue();
  await sourceCode.fill(markup.replace('</main>','<aside id="instrument-note"><p>Detection limit at 526 nm.</p></aside></main>'));
  await expect(canvas.locator('#instrument-note')).toContainText('Detection limit at 526 nm.');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.locator('[data-website-file-page]').selectOption('index.html');await expect(canvas.locator('h1')).toHaveText('Saved HTML acceptance');
  phase='author gallery offline';await page.getByRole('button',{name:'Image gallery',exact:true}).click();
  await page.locator('[data-gallery-files]').setInputFiles(path.resolve('src/preview-assets/image.png'));
  await page.locator('[data-gallery-field="alt"]').fill('Test photograph');await page.locator('[data-gallery-field="caption"]').fill('Recorded observation');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  phase='review saved public files before publication';await page.getByRole('button',{name:'Check website',exact:true}).click();
  const check=page.getByRole('dialog',{name:'Check website'});await expect(check.getByRole('status')).toContainText(/public pages and stylesheets/);await check.getByRole('button',{name:'Close checks'}).click();
  const previewStart=performance.now();await page.getByRole('button',{name:'Preview saved website',exact:true}).click();const saved=page.frameLocator('.website-files-canvas');await expect(saved.locator('main > p')).toHaveCSS('color','rgb(21, 43, 65)');const previewMs=Math.round(performance.now()-previewStart);await saved.getByRole('img',{name:'Test photograph'}).click();await expect(saved.getByRole('dialog')).toBeVisible();await saved.getByRole('button',{name:'Close gallery'}).click();
  const previewUrl=await page.locator('iframe.website-files-canvas').getAttribute('src');const previewBytes=await page.evaluate(async url=>{const response=await fetch(url);if(!response.ok)throw Error('Preview unavailable');return response.text();},previewUrl);
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(output);await page.getByRole('button',{name:'Review file changes',exact:true}).click();
  await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files',exact:true}).click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
  expect(await readFile(path.join(output,'index.html'),'utf8')).toBe(previewBytes);expect(previewBytes).toContain('release-this-result');expect(previewBytes).not.toMatch(/withdraw-this-result|never-export-this-canary|Private appendix/);
  const mediaTypes={'.css':'text/css','.js':'application/javascript','.png':'image/png','.html':'text/html; charset=utf-8','.wav':'audio/wav'};
  server=createServer(async(req,res)=>{const file=req.url==='/'?'index.html':/^\/(?:style\.css|website-appearance\.css|website-themes\/[a-f0-9-]{36}\.css|methods\/index\.html|public-gallery\.(?:js|css)|pictures\/[a-f0-9-]{36}\.png|recordings\/[a-f0-9-]{36}\.wav)$/.test(req.url)?req.url.slice(1):null;if(!file){res.writeHead(404).end();return;}try{res.writeHead(200,{'Content-Type':mediaTypes[path.extname(file)]}).end(await readFile(path.join(output,file)));}catch{res.destroy();}});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));browser=await chromium.launch();const publicPage=await browser.newPage();await publicPage.goto('http://127.0.0.1:'+server.address().port+'/');
  await expect(publicPage.getByText('Edited with PostgreSQL offline.',{exact:true})).toHaveCSS('color','rgb(21, 43, 65)');
  await expect(publicPage.locator('math mfrac')).toBeVisible();await expect(publicPage.locator('p sub')).toHaveText('2');await expect(publicPage.locator('cite')).toHaveText('Transmission calibration protocol');
  await publicPage.getByRole('img',{name:'Test photograph'}).click();await expect(publicPage.getByRole('dialog')).toContainText('Recorded observation');await publicPage.getByRole('button',{name:'Close gallery'}).click();
  await expect(publicPage.locator('p sup')).toHaveText('2');await expect(publicPage.locator('h1')).toHaveCSS('font-family',/Georgia/);
  if(process.env.OBSERVANDA_WEBSITE_LAYOUT_ARCHIVE==='1')await test.info().attach('published-website',{body:await publicPage.screenshot(),contentType:'image/png'});
  await publicPage.locator('nav a').filter({hasText:'Methods'}).click();await expect(publicPage.getByRole('heading',{name:'Methods'})).toHaveCSS('font-family',/Georgia/);
  await expect(publicPage.locator('body')).toHaveCSS('background-color','rgb(24, 35, 44)');await expect(publicPage.locator('#instrument-note')).toContainText('Detection limit at 526 nm.');
  // Fail on any newly introduced API dependency, including a background poll
  // whose failed database read was swallowed by the application.
  const allowed=route=>route.startsWith('/api/website-files/')||['/api/session','/api/access/status','/api/language','/api/interface'].includes(route);
  expect([...new Set(requests.filter(route=>!allowed(route)))]).toEqual([]);expect(errors).toEqual([]);for(const database of databases)expect((await stat(database)).isFile()).toBe(true);
  console.log(JSON.stringify({packaged:Boolean(fixture.packaged),coldOpenMs,previewMs,databasesUnavailable:databases.length,publishedMatchesPreview:true,privateCanaryAbsent:true}));
 }catch(error){failure=error;const screen=await page?.locator('body').innerText({timeout:3000}).catch(()=>'');console.error('Website qualification failed during '+phase+': '+error.message+'\n'+errors.join('\n')+'\n'+screen?.slice(0,1800));throw error;}
 finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));try{await fixture.dispose(app);}catch(error){if(!failure)throw error;}}
});
