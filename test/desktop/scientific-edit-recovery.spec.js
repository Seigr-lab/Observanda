import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopFixture} from './fixture.js';
import {desktopAccess} from './access.js';
import {interruptDesktop} from './interrupt.js';
import {createRecoverySources,exerciseRecovery,recoveryStates} from '../fixtures/scientific-edit-recovery.js';

test('recover each acknowledged scientific edit after abrupt desktop process termination',async()=>{
 test.setTimeout(15*60*1000);
 const fixture=await desktopFixture('observanda-science-interruption-'),access=desktopAccess();
 let app,page,projectRoute,bookRoute,serviceClosed=true,interrupting=false;
 const title='Scientific recovery';
 const call=(route,data,bytes)=>page.evaluate(async({route,data,bytes})=>{
  const context=(await(await fetch('/api/storage')).json()).contextId;
  const response=await fetch(route,{method:'POST',signal:AbortSignal.timeout(45000),headers:{'X-Observanda-Workspace':context,'X-Observanda-Wait':'1','Content-Type':bytes?'application/octet-stream':'application/json'},body:bytes?new Uint8Array(bytes):JSON.stringify(data)});
  if(!response.ok)throw Error(route+' '+response.status+' '+(await response.json()).code);
  return response.json();
 },{route,data,bytes});
 const launch=async()=>{
  app=await fixture.start();page=await app.firstWindow();page.setDefaultTimeout(25000);
  await page.waitForFunction(()=>['setup','access','workspace'].includes(document.documentElement.dataset.appMode),null,{timeout:60000});
  serviceClosed=false;interrupting=false;
 };
 const unlock=async route=>call(route+'/access/unlock',{...access.credentials,recovery:''});
 const terminate=async()=>{
  interrupting=true;
  const oldPid=await interruptDesktop(app,fixture);
  app=null;serviceClosed=true;return oldPid;
 };
 const interrupt=async()=>{
  const oldPid=await terminate();
  console.log('Former service listener closed. Reopening the same disposable workspace.');
  await launch();expect(await app.evaluate(()=>process.pid)).not.toBe(oldPid);
  if(await page.getByRole('heading',{name:'Unlock workspace',exact:true}).isVisible())await access.unlock(page);
  await expect(page.locator('.workspace-name')).toHaveText(title);
  await unlock(projectRoute);await unlock(bookRoute);
  return page;
 };
 let success=false;
 try{
  await mkdir(path.join(fixture.directory,'storage'));await launch();
  await page.getByLabel('Workspace name',{exact:true}).fill(title);
  for(let step=0;step<2;step++)await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Create in',{exact:true}).fill(path.join(fixture.directory,'storage'));await access.setup(page);
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText(title,{timeout:90000});
  const {project}=await call('/api/projects/create',{id:randomUUID(),...access.credentials,project:{id:randomUUID(),title:'Monitoring project',parentId:null,description:'',share:false,logoId:null}});
  projectRoute='/api/projects/'+project.projectId;await unlock(projectRoute);
  const {book}=await call(projectRoute+'/lab-books/create',{id:randomUUID(),...access.credentials,book:{id:randomUUID(),projectId:project.projectId,title:'Field readings'}});
  bookRoute=projectRoute+'/lab-books/'+book.labBookId;await unlock(bookRoute);
  const now=new Date().toISOString(),recordId=randomUUID(),scope={workspaceId:book.namespaceId,recordId};
  const record={id:recordId,notebookId:book.labBookId,type:'experiment',title:'Scientific recovery readings',body:'',contributors:[],relations:[],tags:[],occurredOn:now.slice(0,10),createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',attachments:[],sections:[]};
  await call(bookRoute+'/research/records/save',{workspaceId:scope.workspaceId,changes:[{id:recordId,expectedRevision:null,record}]});
  const material=(name,data,bytes)=>call(bookRoute+'/research/materials/'+name,data,bytes);
  async function result(id){
   let job;
   await expect.poll(async()=>{({job}=await material('job',{id}));return job.state==='queued'||job.state==='running'?'pending':job.state;},{timeout:60000}).toBe('completed');
   return job.result;
  }
  const sources=await createRecoverySources(async(name,data)=>{
   const response=await material(name,data);return response.job?result(response.job.id):response.ref;
  },recordId,async bytes=>{
   const upload=await material('start',{recordId,name:'readings.csv',size:bytes.length});
   await material('chunk/'+upload.id+'/0',null,[...bytes]);return result((await material('finish',{id:upload.id})).job.id);
  });
  const owner={...scope,projectId:project.projectId,labBookId:book.labBookId};
  const openRecord=async renderer=>{
   const route='#/owners/'+project.projectId+'/books/'+book.labBookId+'/records/'+recordId;
   if(new URL(renderer.url()).hash!==route)await renderer.goto(new URL(route,renderer.url()).href);
   await expect(renderer.getByRole('heading',{name:record.title,exact:true}).first()).toBeVisible({timeout:45000});
  };
  for(const id of Object.keys(recoveryStates))await test.step('S06-'+id+'-K',async()=>{
   console.log('Starting S06-'+id+'-K');
   const mutations=[];
   const listen=renderer=>renderer.on('request',request=>{if(request.method()==='POST'&&/\/(?:intake-start|stage|apply|dataset|plot|dataset-preview|calculation-graph-change|uncertainty-change)$/.test(new URL(request.url()).pathname))mutations.push(request.url());});
   listen(page);
   const recovered=await exerciseRecovery({page,id,mode:'K',recordId,openRecord,interrupt:async()=>{console.log('Checkpoint acknowledged, interrupting disposable desktop.');const fresh=await interrupt();listen(fresh);return fresh;},inspectScope:async()=>{
    const {items}=await material('scientific-draft-browse',{workspaceId:scope.workspaceId,limit:20});
    for(const item of items)expect(item.owner).toEqual(owner);
    return items;
   },inspectDetails:row=>material('scientific-draft-read',{...scope,id:row.id,expectedRevision:row.revision})});
   page=recovered.page;expect(mutations).toEqual([]);
   for(const ref of Object.values(sources))expect((await material('current',{id:ref.id})).item.revision).toBe(ref.revision);
   await page.locator('[data-action="material-recovery-keep"]').click();await expect(page.locator('#dialog')).toBeHidden();
   console.log('Passed S06-'+id+'-K');
  },{timeout:150000});
  success=true;
 }catch(error){
  console.error('Scientific desktop recovery failed:',error.message);
  if(page&&!page.isClosed())console.error('Disposable workspace screen:',(await page.locator('body').innerText({timeout:3000}).catch(()=>'' )).slice(0,1400));
  throw error;
 }finally{
  if(!success&&app&&!interrupting)await terminate();
  if(success||serviceClosed)await fixture.dispose(app);
 }
});
