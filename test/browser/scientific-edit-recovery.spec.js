import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {CalculationGraphs} from '../../src/calculation-graphs.js';
import {ScientificEditDrafts} from '../../src/scientific-edit-drafts.js';
import {StatisticalUncertaintyDefinitions} from '../../src/statistical-uncertainty-definitions.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createRecoverySources,exerciseRecovery,recoveryStates} from '../fixtures/scientific-edit-recovery.js';
import {openEvidence} from './record-editor-helper.js';

let directory,f,app,scope,drafts,materials,sources;
test.beforeAll(async()=>{
 directory=await mkdtemp(path.join(os.tmpdir(),'observanda-scientific-recovery-ui-'));
 const book=sampleNotebook();scope={recordId:book.entries[0].id,workspaceId:book.id};
 f=await encryptedFixture(directory,book);materials=new ResearchMaterials(f.workspace);drafts=new ScientificEditDrafts(materials);
 const graphs=new CalculationGraphs(materials),uncertainty=new StatisticalUncertaintyDefinitions(materials);
 const calls={'dataset':command=>materials.dataset(command),'calculation-graph-create':command=>graphs.create(command),'uncertainty-create':command=>uncertainty.create(command),'uncertainty-change':command=>uncertainty.change(command)};
 sources=await createRecoverySources((name,data)=>calls[name](data),scope.recordId,async bytes=>{
  const incoming=await materials.startImport({recordId:scope.recordId,name:'readings.csv',size:bytes.length});await materials.appendImport(incoming.id,0,[bytes]);return materials.finishImport(incoming.id);
 });
 app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,headless:true,port:0,preferencesFile:path.join(directory,'preferences.json')});
});
test.afterAll(async()=>{await app?.close();if(f)await clearVault(f.vault);if(directory)await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
for(const id of Object.keys(recoveryStates))for(const mode of ['C','N','R']){
 test('S06-'+id+'-'+mode+' restores the pending '+recoveryStates[id]+' edit through the workbench',async({page})=>{
  test.setTimeout(90000);page.setDefaultTimeout(12000);
  const mutated=[],errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{
   if(request.method()==='POST'&&/\/(?:dataset|dataset-preview|plot|calculation-graph-change|uncertainty-change|intake-start|stage|apply)$/.test(new URL(request.url()).pathname))mutated.push(new URL(request.url()).pathname);
  });
  await page.goto(app.url);
  const result=await exerciseRecovery({page,id,mode,recordId:scope.recordId,openRecord:async renderer=>{await renderer.goto(app.origin+'/#/records/'+scope.recordId);},inspectScope:async()=>(await drafts.list(scope)).items,inspectDetails:row=>drafts.read({...scope,id:row.id,expectedRevision:row.revision})});
  expect(mutated).toEqual([]);expect(errors).toEqual([]);
  for(const ref of Object.values(sources))expect((await materials.current(ref.id)).revision).toBe(ref.revision);
  expect((await drafts.list(scope)).items.some(item=>item.id===result.id)).toBe(true);
 });
}
test('failed keep stays in the editor; an uncertain write followed by a newer edit and explicit discard use the exact acknowledgement',async({page})=>{
 const earlier=(await drafts.list(scope)).items;
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const dialog=page.locator('#dialog'),guard=page.locator('#leave-dialog'),source=dialog.locator('#continuing-source');
 await page.goto(app.url);await page.goto(app.origin+'/#/records/'+scope.recordId);
 await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
 await openEvidence(page);
 await dialog.locator('[data-action="material-continuing-home"]').click();
 await page.evaluate(()=>{
  const send=window.fetch.bind(window),fault=window.recoveryFault={mode:'lose',requests:[],acknowledged:null};
  window.fetch=async(input,options)=>{
   if(!new URL(input,location.origin).pathname.endsWith('/research/materials/scientific-draft-write'))return send(input,options);
   const body=JSON.parse(options.body);fault.requests.push({value:body.value.source,expectedRevision:body.expectedRevision});
   if(fault.mode==='lose'){
    const response=await send(input,options);if(!response.ok)return response;
    fault.acknowledged=await response.json();fault.mode='full';throw new TypeError('Lost the response after the writer committed.');
   }
   if(fault.mode==='full')return Response.json({code:'STORAGE_FULL',message:'The test volume is full.'},{status:507});
   return send(input,options);
  };
 });
 await source.fill('unacknowledged observation');
 await expect(dialog.getByText('Could not save the recovery copy. Keep this editor open and retry.',{exact:true})).toBeVisible();
 await source.fill('later observation');
 await page.evaluate(()=>{location.hash='#/tools';});await guard.getByRole('button',{name:'Keep recovery copy and continue'}).click();
 await expect(guard.getByRole('alert')).toBeVisible();await expect(source).toHaveValue('later observation');
 await guard.getByRole('button',{name:'Stay here'}).click();await expect(dialog).toBeVisible();
 await page.evaluate(()=>{window.recoveryFault.mode='normal';});
 await dialog.getByRole('button',{name:'Keep recovery copy and close'}).click();await expect(dialog).toBeHidden();
 const {requests,acknowledged}=await page.evaluate(()=>window.recoveryFault);
 expect(requests.at(-2)).toEqual({value:'unacknowledged observation',expectedRevision:null});
 expect(requests.at(-1)).toEqual({value:'later observation',expectedRevision:acknowledged.revision});
 const found=(await drafts.list(scope)).items.find(item=>item.id===acknowledged.id);
 expect((await drafts.read({...scope,id:found.id,expectedRevision:found.revision})).value.source).toBe('later observation');
 await openEvidence(page);
 await dialog.locator('[data-action="material-recovery-open"][data-id="'+found.id+'"]').click();
 await source.fill('unsaved correction');
 await page.evaluate(()=>{location.hash='#/tools';});await guard.getByRole('button',{name:'Discard changes'}).click();
 await expect.poll(async()=>(await drafts.list(scope)).items.some(row=>row.id===found.id)).toBe(false);
 await expect(dialog).toBeHidden();
 await page.goto(app.origin+'/#/records/'+scope.recordId);
 await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
 await openEvidence(page);
 await dialog.locator('[data-action="material-continuing-home"]').click();
 await page.evaluate(()=>{window.recoveryFault.mode='full';});
 await source.fill('Never admitted');
 await expect(dialog.getByText('Could not save the recovery copy. Keep this editor open and retry.',{exact:true})).toBeVisible();
 const count=await page.evaluate(()=>window.recoveryFault.requests.length);
 await page.evaluate(()=>{location.hash='#/tools';});await guard.getByRole('button',{name:'Discard changes'}).click();
 await expect(dialog).toBeHidden();
 expect(await page.evaluate(()=>window.recoveryFault.requests.length)).toBe(count);
 expect((await drafts.list(scope)).items).toEqual(earlier);
});
