import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function pageModules(page){
 await page.route('https://publication-requests.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;await route.fulfill({contentType:pathname==='/'?'text/html':pathname.endsWith('.json')?'application/json':'text/javascript',body:pathname==='/'?'<main></main><dialog id="dialog"></dialog>':await readFile(new URL('../../src/web'+pathname,import.meta.url),'utf8')});});
 await page.goto('https://publication-requests.test/');
}

test('lost preparation acknowledgement recovers the same admission without creating a second edition',async({page})=>{
 await pageModules(page);await page.evaluate(async()=>{
  const {publicationJobsUI}=await import('/publication-jobs-ui.js');
  window.calls=[];window.errors=[];window.jobs=new Map();window.completed=false;window.statusAvailable=false;
  const state={storage:{contextId:crypto.randomUUID()},websiteId:crypto.randomUUID(),websitePin:{websiteRevision:'a'.repeat(64)}},esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;');
  const api=async(path,data)=>{
   calls.push({path,data:structuredClone(data)});
   if(path.endsWith('/start')){let job=jobs.get(data.commandId);if(!job){job={id:data.commandId,state:'queued',createdAt:new Date().toISOString(),progress:{stage:'queued',done:0,total:0}};jobs.set(job.id,job);throw Error('Connection interrupted');}return {job};}
   if(path.endsWith('/status')){if(!statusAvailable)throw Error('Connection interrupted');const job=jobs.get(data.id);return {job:completed?{...job,state:'completed',result:{id:'b'.repeat(64)}}:job};}
   if(path.endsWith('/open'))return {id:data.id,summary:{pages:121}};
   throw Error('Unexpected request');
  };
  window.ui=publicationJobsUI({state,api,esc,showDialog:html=>{dialog.innerHTML=html;dialog.showModal();},notify:message=>errors.push(message),showReview:preview=>{window.opened=preview;}});
  document.addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(control)void ui.action(control).catch(error=>errors.push(error.message));});
  await ui.start({etag:'a'.repeat(64),websitePin:state.websitePin});
 });
 await expect(page.getByRole('button',{name:'Recover preparation status'})).toBeVisible();
 expect(await page.evaluate(()=>jobs.size)).toBe(1);await page.evaluate(()=>{window.statusAvailable=true;});
 await page.getByRole('button',{name:'Recover preparation status'}).click();await page.evaluate(()=>{window.completed=true;});
 await expect.poll(()=>page.evaluate(()=>window.opened?.summary.pages)).toBe(121);
 expect(await page.evaluate(()=>new Set(calls.filter(call=>call.path.endsWith('/start')).map(call=>call.data.commandId)).size)).toBe(1);
 expect(await page.evaluate(()=>jobs.size)).toBe(1);expect(await page.evaluate(()=>errors)).toEqual([]);
});

test('uncertain analysis decisions retain their text and recover one atomic seven-decision receipt',async({page})=>{
 await pageModules(page);await page.evaluate(async()=>{
  const {saveAnalysisEditionReview}=await import('/analysis-review-ui.js');
  window.calls=[];window.jobs=new Map();window.errors=[];window.release=false;
  const items=Array.from({length:7},(_,index)=>({id:(index+1).toString(16).padStart(64,'0'),decision:null}));
  window.state={preview:{id:'a'.repeat(64),websitePin:{websiteId:crypto.randomUUID()},analysisReview:{reviewed:false,decided:0,total:7},analysisReviewWindow:{items,offset:0,total:7}}};
  document.querySelector('main').innerHTML=items.map((item,index)=>'<textarea data-analysis-decision="'+item.id+'">Retain result '+index+' with its original source revision.</textarea>').join('')+'<p data-analysis-review-operation role="status"></p><button id="save">Save decisions</button>';
  const api=async(path,data)=>{
   calls.push({path,data:structuredClone(data)});
   if(path.endsWith('/analysis-review')){let job=jobs.get(data.commandId);if(!job){job={id:data.commandId,state:'queued',result:null};jobs.set(job.id,job);throw Error('Connection interrupted');}return {job};}
   if(path.endsWith('/analysis-review-status')){const job=jobs.get(data.id),command=calls.find(call=>call.data.commandId===data.id).data;return {job:release?{...job,state:'completed',result:{reviewed:true,decided:7,total:7,decisions:command.decisions}}:job};}
   throw Error('Unexpected request');
  };
  document.getElementById('save').onclick=()=>{window.saving=saveAnalysisEditionReview(state,api).catch(error=>errors.push(error.message));};
 });
 await page.getByRole('button',{name:'Save decisions',exact:true}).click();await expect(page.getByRole('status')).toContainText('not confirmed');
 await expect(page.locator('[data-analysis-decision]')).toHaveCount(7);expect(await page.evaluate(()=>state.preview.analysisReview.decided)).toBe(0);
 await page.getByRole('button',{name:'Save decisions',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saving review decisions');
 await page.evaluate(()=>{window.release=true;});await expect.poll(()=>page.evaluate(()=>state.preview.analysisReview.decided)).toBe(7);
 expect(await page.evaluate(()=>jobs.size)).toBe(1);expect(await page.evaluate(()=>new Set(calls.filter(call=>call.path.endsWith('/analysis-review')).map(call=>call.data.commandId)).size)).toBe(1);
 expect(await page.evaluate(()=>state.preview.analysisReviewWindow.items.every(item=>item.decision?.reason.includes('original source revision')))).toBe(true);
 expect(await page.evaluate(()=>state.preview.analysisReviewPending)).toBeUndefined();
});

test('reopening a failed analysis save restores its decisions and retries the same operation',async({page})=>{
 await pageModules(page);await page.evaluate(async()=>{
  const {analysisEditionReviewView,saveAnalysisEditionReview}=await import('/analysis-review-ui.js');
  const decisions=Array.from({length:7},(_,index)=>({id:(index+1).toString(16).padStart(64,'0'),reason:'Previously entered interpretation '+index})),operation={id:crypto.randomUUID(),state:'failed',error:'ACCESS_LOCKED',decisions};
  window.calls=[];window.errors=[];window.state={preview:{id:'a'.repeat(64),researchReview:{analysis:{count:7}},analysisReview:{reviewed:false,decided:0,total:7},analysisReviewOperation:operation,analysisReviewWindow:{items:decisions.map(item=>({id:item.id,sample:[],changed:1,label:'Retained interpretation',decision:null})),offset:0,total:7,next:null}}};
  document.querySelector('main').innerHTML=analysisEditionReviewView(state.preview,{esc:String,field:(label,input)=>'<label>'+label+input+'</label>'});
  const result={reviewed:true,decided:7,total:7,decisions},api=async(path,data)=>{
   calls.push({path,data:structuredClone(data)});
   if(path.endsWith('/analysis-review'))return {job:operation};
   if(path.endsWith('/analysis-review-retry'))return {job:{...operation,state:'completed',result}};
   throw Error('Unexpected operation');
  };
  document.querySelector('[data-action="analysis-review-save"]').onclick=()=>saveAnalysisEditionReview(state,api).catch(error=>errors.push(error.message));
 });
 await expect(page.locator('[data-analysis-decision]')).toHaveCount(7);
 await expect(page.locator('[data-analysis-decision]').nth(6)).toHaveValue('Previously entered interpretation 6');
 await page.getByRole('button',{name:'Save analysis review decisions',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>state.preview.analysisReview.decided)).toBe(7);
 expect(await page.evaluate(()=>calls[0].data.commandId===calls[1].data.id)).toBe(true);
 expect(await page.evaluate(()=>calls.map(call=>call.path))).toEqual(['/api/publication-jobs/analysis-review','/api/publication-jobs/analysis-review-retry']);
 expect(await page.evaluate(()=>errors)).toEqual([]);
});
