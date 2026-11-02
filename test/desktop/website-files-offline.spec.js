import {test,expect,chromium} from '@playwright/test';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {websiteDesktopFixture} from './installed-website-app.js';
import {sampleNotebook} from '../../src/sample.js';

async function selectEntry(page){
 const seed=sampleNotebook(),entry=seed.entries[2];seed.entries=[entry];entry.title='Retained observation';entry.body='Permitted record body';entry.share=false;
 entry.sections=[{id:randomUUID(),title:'First result',body:'withdraw-this-result',share:true},{id:randomUUID(),title:'Second result',body:'release-this-result',share:false},{id:randomUUID(),title:'Private appendix',body:'never-export-this-canary',share:false}];
 return page.evaluate(async seed=>{
  const context=(await(await fetch('/api/storage')).json()).contextId,headers={'Content-Type':'application/json','X-Observanda-Workspace':context};
  async function call(route,data){const response=await fetch(route,{headers,...(data?{method:'POST',body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(route+': '+result.code);return result;}
  const projectId=crypto.randomUUID(),project=(await call('/api/projects/create',{id:crypto.randomUUID(),username:'',password:'',project:{id:projectId,title:'Optics project',description:'',share:true,logoId:null}})).project;
  const books='/api/projects/'+projectId+'/lab-books',book=(await call(books+'/create',{id:crypto.randomUUID(),username:'',password:'',book:{id:crypto.randomUUID(),projectId,title:'Measurement book'}})).book,prefix=books+'/'+book.labBookId;
  const entry=seed.entries[0];entry.notebookId=book.labBookId;await call(prefix+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:entry.id,expectedRevision:null,record:entry}]});
  const target={workspaceId:book.namespaceId,recordId:entry.id,field:'share'},prior=await call(prefix+'/research/records/values/read',target);await call(prefix+'/research/records/values/save',{...target,expectedRevision:prior.revision,value:{value:true}});
  return {context,prefix,workspaceId:book.namespaceId,recordId:entry.id,sections:entry.sections.map(value=>value.id),roots:[project.root,book.root]};
 },seed);
}
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
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  await page.getByLabel('Workspace name',{exact:true}).fill('Website acceptance');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Create in',{exact:true}).fill(fixture.directory);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.topbar .workspace-name')).toHaveText('Website acceptance',{timeout:60000});phase='select permitted research';const source=await selectEntry(page);phase='open file editor';await page.locator('#main-navigation').getByRole('button',{name:'Website editor',exact:true}).click();
  await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Saved HTML acceptance');await page.locator('form[data-website-files-form]').getByRole('button',{name:'New website',exact:true}).click();
  await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Saved HTML acceptance');phase='insert converted research';await page.getByRole('button',{name:'Available content',exact:true}).click();await page.getByRole('button',{name:'Retained observation',exact:true}).click();
  const placed=page.frameLocator('#website-files-canvas').locator('[data-observanda-source]');await expect(placed).toContainText('withdraw-this-result');await expect(placed).not.toContainText('release-this-result');const placement=await placed.getAttribute('data-observanda-source');
  phase='change visibility of placed entry';await updateVisibility(page,source);await expect(placed).toContainText('release-this-result',{timeout:20000});await expect(placed).not.toContainText('withdraw-this-result');expect(await placed.getAttribute('data-observanda-source')).toBe(placement);
  phase='stop before quarantine';await fixture.close(app);app=null;

  // Every path below belongs solely to the private disposable test fixture.
  // Block the exact PostgreSQL runtime location after graceful shutdown. A file
  // at its original path also prevents startup from creating a replacement.
  const databases=[workspace,...source.roots].map(root=>path.resolve(root,'.observanda','postgresql'));
  for(const database of databases){if(!database.startsWith(path.resolve(fixture.directory)+path.sep)||!(await stat(database)).isDirectory())throw Error('Unexpected disposable database layout');await rename(database,database+'-offline');await writeFile(database,'Research PostgreSQL is deliberately unavailable.\n',{flag:'wx'});}
  phase='open offline file editor';const coldStart=performance.now();app=await fixture.start(undefined,{website:true});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  app.context().on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))requests.push(url.pathname);});
  await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Saved HTML acceptance',{timeout:60000});
  const coldOpenMs=Math.round(performance.now()-coldStart);
  requests.push(...await page.evaluate(()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname).filter(route=>route.startsWith('/api/'))));
  await page.getByRole('button',{name:'Add paragraph',exact:true}).click();const canvas=page.frameLocator('#website-files-canvas');
  phase='type in visual editor';const paragraph=canvas.locator('main > p').last();await paragraph.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.type('Edited with PostgreSQL offline.');await expect(paragraph).toHaveText('Edited with PostgreSQL offline.');
  phase='save visual and CSS edits';
  await page.getByRole('button',{name:'CSS',exact:true}).click();await page.getByRole('textbox',{name:'CSS',exact:true}).fill('main > p { color: rgb(21, 43, 65); }');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');await page.reload();
  await expect(page.frameLocator('#website-files-canvas').locator('main > p')).toHaveText('Edited with PostgreSQL offline.');
  const previewStart=performance.now();await page.getByRole('button',{name:'Preview saved website',exact:true}).click();const saved=page.frameLocator('.website-files-canvas');await expect(saved.locator('main > p')).toHaveCSS('color','rgb(21, 43, 65)');const previewMs=Math.round(performance.now()-previewStart);
  const previewUrl=await page.locator('iframe.website-files-canvas').getAttribute('src');const previewBytes=await page.evaluate(async url=>{const response=await fetch(url);if(!response.ok)throw Error('Preview unavailable');return response.text();},previewUrl);
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(output);await page.getByRole('button',{name:'Review file changes',exact:true}).click();
  await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files',exact:true}).click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
  expect(await readFile(path.join(output,'index.html'),'utf8')).toBe(previewBytes);expect(previewBytes).toContain('release-this-result');expect(previewBytes).not.toMatch(/withdraw-this-result|never-export-this-canary|Private appendix/);
  server=createServer(async(req,res)=>{const file=req.url==='/'?'index.html':req.url==='/style.css'?'style.css':null;if(!file){res.writeHead(404).end();return;}try{res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'}).end(await readFile(path.join(output,file)));}catch{res.destroy();}});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));browser=await chromium.launch();const publicPage=await browser.newPage();await publicPage.goto('http://127.0.0.1:'+server.address().port+'/');
  await expect(publicPage.getByText('Edited with PostgreSQL offline.',{exact:true})).toHaveCSS('color','rgb(21, 43, 65)');
  await test.info().attach('published-website',{body:await publicPage.screenshot(),contentType:'image/png'});
  // Fail on any newly introduced API dependency, including a background poll
  // whose failed database read was swallowed by the application.
  const allowed=route=>route.startsWith('/api/website-files/')||['/api/session','/api/access/status','/api/preferences'].includes(route);
  expect([...new Set(requests.filter(route=>!allowed(route)))]).toEqual([]);expect(errors).toEqual([]);for(const database of databases)expect((await stat(database)).isFile()).toBe(true);
  console.log(JSON.stringify({packaged:Boolean(fixture.packaged),coldOpenMs,previewMs,databasesUnavailable:databases.length,publishedMatchesPreview:true,privateCanaryAbsent:true}));
 }catch(error){failure=error;const screen=await page?.locator('body').innerText({timeout:3000}).catch(()=>'');console.error('Website qualification failed during '+phase+': '+error.message+'\n'+errors.join('\n')+'\n'+screen?.slice(0,1800));throw error;}
 finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));try{await fixture.dispose(app);}catch(error){if(!failure)throw error;}}
});
