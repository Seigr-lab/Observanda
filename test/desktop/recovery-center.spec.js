import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {desktopFixture} from './fixture.js';
import {desktopAccess} from './access.js';
import {interruptDesktop} from './interrupt.js';

test('one desktop restart restores the selected record, scientific form and original website image through Tools',async()=>{
 test.setTimeout(240000);
 test.skip(!!process.env.OBSERVANDA_DESKTOP_EXECUTABLE,'Requires the source desktop main-process interruption fixture.');
 const fixture=await desktopFixture('observanda-recovery-center-');
 const access=desktopAccess(),title='Field recovery';
 const originalImage=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url));
 let app,page,completed=false;
 async function launch(){
  app=await fixture.start();page=await app.firstWindow();
  await page.waitForFunction(()=>['setup','access','workspace'].includes(document.documentElement.dataset.appMode));
 }
 async function post(route,command){
  return page.evaluate(async({route,command})=>{
   const {contextId}=await (await fetch('/api/storage')).json();
   const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',
    'X-Observanda-Workspace':contextId,'X-Observanda-Wait':'1'},body:JSON.stringify(command)});
   const result=await response.json();if(!response.ok)throw Error(route+' '+result.code);return result;
  },{route,command});
 }
 const unlock=route=>post(route+'/access/unlock',{...access.credentials,recovery:''});
 async function imageHash(url){
  return page.evaluate(async address=>{
   const response=await fetch(address);
   if(!response.ok||response.headers.get('content-type')!=='image/png')throw Error('Cannot read the selected PNG: '+response.status);
   const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
   return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  },url.href);
 }
 try{
  await launch();
  await page.getByLabel('Workspace name',{exact:true}).fill(title);
  for(let step=0;step<2;step++)await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Create in',{exact:true}).fill(fixture.directory);await access.setup(page);
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.topbar .workspace-name')).toHaveText(title,{timeout:60000});
  const {project}=await post('/api/projects/create',{id:randomUUID(),...access.credentials,project:{
   id:randomUUID(),title:'Field study',parentId:null,description:'',share:false,logoId:null}});
  const projectRoute='/api/projects/'+project.projectId;await unlock(projectRoute);
  const {book}=await post(projectRoute+'/lab-books/create',{id:randomUUID(),...access.credentials,book:{
   id:randomUUID(),projectId:project.projectId,title:'Field notes'}});
  const bookRoute=projectRoute+'/lab-books/'+book.labBookId;await unlock(bookRoute);
  const workspaceId=book.namespaceId,now=new Date().toISOString();
  const record={id:randomUUID(),notebookId:book.labBookId,type:'experiment',title:'Field team',
   body:'',contributors:[],relations:[],tags:[],occurredOn:now.slice(0,10),createdAt:now,updatedAt:now,
   share:false,figures:[],status:'draft',attachments:[],sections:[]};
  await post(bookRoute+'/research/records/save',{workspaceId,changes:[{id:record.id,expectedRevision:null,record}]});
  const unfinished={...record,id:randomUUID(),title:'Barometric survey',body:'Recovery reading: 1005.4 hPa'};
  const recordDraft=await post(bookRoute+'/research/drafts/write',{workspaceId,id:randomUUID(),expectedRevision:null,
   changes:[{record:unfinished,base:null,expectedRevision:null}]});
  expect(recordDraft.revision).toMatch(/^[a-f0-9]{64}$/);
  const source='unsubmitted/field-survey',scientific=await post(bookRoute+'/research/materials/scientific-draft-write',{
   workspaceId,recordId:record.id,id:randomUUID(),expectedRevision:null,kind:'local-intake',base:null,value:{source,proposal:null}});
  expect(scientific.revision).toMatch(/^[a-f0-9]{64}$/);
  const saved=await post('/api/website-files/create',{name:'Field guide'});
  await page.goto(new URL('/#/websites/'+saved.site.id+'/editor',page.url()).href);
  await page.getByRole('button',{name:'Image gallery',exact:true}).click();
  await page.locator('[data-gallery-files]').setInputFiles({name:'survey.png',mimeType:'image/png',buffer:originalImage});
  await page.locator('[data-gallery-field=alt]').fill('Survey station');
  await page.locator('[data-action=website-files-gallery-close]').click();
  await expect(page.getByText(/Recovery copy saved at/)).toBeVisible({timeout:20000});
  let confirmed;
  await expect.poll(async()=>{
   const {items}=await post('/api/website-files/recovery/list',{limit:10});
   const row=items.find(item=>item.owner.websiteId===saved.site.id);
   if(!row)return false;
   confirmed=await post('/api/website-files/recovery/read',{siteId:saved.site.id,path:row.documentKey,id:row.id,revision:row.revision});
   return confirmed.html?.includes('Survey station')&&confirmed.pictures?.length===1;
  }).toBe(true);
  const row=confirmed.summary,picture=confirmed.pictures[0].name;
  const beforeURL=new URL('/api/website-files/preview/'+saved.site.id+'/'+saved.assetStamp+'/_recovery/'+row.id+'/'+row.revision+'/'+picture,page.url());
  beforeURL.searchParams.set('page',row.documentKey);
  const imageDigest=await imageHash(beforeURL);
  const formerPid=await interruptDesktop(app,fixture);app=null;
  await launch();expect(await app.evaluate(()=>process.pid)).not.toBe(formerPid);
  if(await page.getByRole('heading',{name:'Unlock workspace',exact:true}).isVisible())await access.unlock(page);
  await expect(page.locator('.workspace-name').first()).toHaveText(title,{timeout:60000});
  await unlock(projectRoute);await unlock(bookRoute);
  const toolsRoute='/#/owners/'+project.projectId+'/books/'+book.labBookId+'/tools';
  async function openArea(area){
   await page.goto(new URL(toolsRoute,page.url()).href);
   await page.locator('[data-tool-card="recovery"]').getByRole('button',{name:'Open',exact:true}).click();
   const center=page.getByRole('dialog',{name:'Recover unfinished work',exact:true});
   await center.getByRole('button',{name:area,exact:true}).click();
   return center;
  }
  await openArea('Record drafts');
  const drafts=page.getByRole('dialog',{name:'Recoverable record drafts'});await expect(drafts).toContainText(unfinished.title);
  await drafts.getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(page.locator('.record-draft-preview')).toContainText(unfinished.body);
  await page.locator('[data-preview-back]').click();await drafts.getByRole('button',{name:'Close',exact:true}).click();
  const science=await openArea('Scientific edits');await science.getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(page.locator('#continuing-source')).toHaveValue(source);
  await page.locator('[data-action="material-recovery-keep"]').click();
  const websites=await openArea('Website pages');await websites.getByRole('button',{name:'Review draft',exact:true}).click();
  await page.getByRole('button',{name:'Recover draft',exact:true}).click();
  const recovered=page.frameLocator('#website-files-canvas').getByAltText('Survey station',{exact:true});
  await expect.poll(()=>recovered.evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Save website',exact:true}).click();
  await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const result=await post('/api/website-files/open',{siteId:saved.site.id,path:saved.path});
  const afterURL=new URL('/api/website-files/preview/'+saved.site.id+'/'+result.site.revision+'/'+picture,page.url());
  expect(await imageHash(afterURL)).toBe(imageDigest);
  completed=true;
 }finally{
  if(!completed&&app&&page?.url().startsWith('http://127.0.0.1:')){
   await interruptDesktop(app,fixture);app=null;
  }
  await fixture.dispose(app);
 }
});
