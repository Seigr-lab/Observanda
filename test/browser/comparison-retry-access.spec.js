import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function fixture(page){
 await page.route('https://comparison.test/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:'<main></main><dialog id="dialog"></dialog>'});return route.fulfill({contentType:path.endsWith('.json')?'application/json':'text/javascript',body:await readFile(new URL('../../src/web'+path,import.meta.url),'utf8')});});
 await page.goto('https://comparison.test/');await page.evaluate(async()=>{
  const {researchMaterialsUI}=await import('/research-materials-ui.js'),id=()=>crypto.randomUUID();window.source={workspaceId:id(),kind:'dataset',id:id(),revision:'a'.repeat(64)};window.record={id:id(),title:'Result observation',type:'observation',figures:[]};window.state={page:'record-reader',selected:record.id,book:{id:id(),title:'Result project',entries:[record]},projectOwner:{projectId:id(),labBookId:null},storage:{contextId:id(),researchStorage:'catalogue',researchFormatVersion:21}};
  window.job={id:id(),type:'analysis.compare',state:'queued',sources:[source],title:'Retained comparison',progress:{done:0,total:1},message:'Waiting for selected sources'};window.calls=[];window.prompts=0;window.polls=0;window.mode='cancel';window.errors=[];window.held=null;
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const showDialog=html=>{const dialog=document.getElementById('dialog');dialog.innerHTML=html;if(!dialog.open)dialog.showModal();};
  window.materials=researchMaterialsUI({state,esc,field:(label,control)=>'<label>'+label+control+'</label>',showDialog,notify:message=>errors.push(message),dirty(){},render(){},revisions:()=>({[record.id]:'a'.repeat(64)}),create(){},access:async run=>{prompts++;if(mode==='cancel')throw new DOMException('Cancelled','AbortError');return run();},api:async(path,body,options)=>{
   const name=path.split('/').at(-1);calls.push({name,body,owner:options?.owner});
   if(name==='overview')return {items:[],imports:[],next:null,importsNext:null};if(['dataset-jobs','drafts','association-list'].includes(name))return {items:[],next:null};
   if(name==='job'){polls++;return {job:{...job,...(polls>1?{state:'failed',message:'Selected source is locked'}:{})}};}
   if(name==='source-resolve'){if(mode==='held')await new Promise(resolve=>held=resolve);return {workspaceId:state.book.id,reference:source,owner:{workspaceId:source.workspaceId,projectId:id(),labBookId:id()},title:'Retained source'};}
   if(name==='retry-job')return {job:{...job,state:'cancelled',message:'Synthetic resumed job'}};throw Error('Unexpected '+name);
  }});
  document.addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(control)void materials.action(control).catch(error=>{if(error.name!=='AbortError')errors.push(error.message);});});
  await materials.action({dataset:{action:'material-open'}});await materials.action({dataset:{action:'material-dataset-job',job:job.id}});
 });
}
test('comparison polling does not prompt and explicit retry resolves retained sources before the same captured job',async({page})=>{
 await fixture(page);const retry=page.locator('[data-action="material-job-retry"]');await expect(retry).toBeVisible();expect(await page.evaluate(()=>prompts)).toBe(0);expect(await page.evaluate(()=>calls.filter(call=>call.name==='source-resolve'))).toEqual([]);
 await retry.click();await expect(retry).toBeEnabled();expect(await page.evaluate(()=>calls.filter(call=>call.name==='retry-job'))).toEqual([]);await expect(page.locator('[data-comparison-progress]')).toHaveText('Selected source is locked');
 await page.evaluate(()=>mode='success');await retry.click();await expect(page.locator('[data-comparison-progress]')).toHaveText('Synthetic resumed job');
 const evidence=await page.evaluate(()=>({calls,source,jobId:job.id,owner:state.projectOwner.projectId,errors}));expect(evidence.calls.filter(call=>call.name==='source-resolve').map(call=>call.body.ref)).toEqual([evidence.source]);expect(evidence.calls.filter(call=>call.name==='retry-job').map(call=>call.body.id)).toEqual([evidence.jobId]);expect(evidence.calls.filter(call=>call.name==='retry-job')[0].owner).toBe(evidence.owner);expect(evidence.errors).toEqual([]);
});
test('a late source authorization cannot resume a comparison after its progress view was left',async({page})=>{
 await fixture(page);const retry=page.locator('[data-action="material-job-retry"]');await expect(retry).toBeVisible();await page.evaluate(()=>mode='held');await retry.click();await expect.poll(()=>page.evaluate(()=>typeof held)).toBe('function');
 await page.evaluate(async()=>{await materials.action({dataset:{action:'material-home'}});held();});await expect(page.locator('#dialog h2')).toHaveText('Evidence & analysis');await expect.poll(()=>page.evaluate(()=>calls.filter(call=>call.name==='retry-job').length)).toBe(0);expect(await page.evaluate(()=>errors)).toEqual([]);
});
