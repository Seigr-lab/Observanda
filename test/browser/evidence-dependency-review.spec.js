import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function fixture(page,{readonly=false,holdExtras=false}={}){
 await page.route('https://evidence-review.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  await route.fulfill({contentType:pathname==='/'?'text/html':pathname.endsWith('.json')?'application/json':'text/javascript',body:pathname==='/'?'<main></main><dialog id="dialog"></dialog>':await readFile(new URL('../../src/web'+pathname,import.meta.url),'utf8')});
 });
 await page.goto('https://evidence-review.test/');
 await page.evaluate(async({readonly,holdExtras})=>{
  const {researchMaterialsUI}=await import('/research-materials-ui.js'),id=()=>crypto.randomUUID();
  window.record={id:id(),title:'Instrument observations',figures:[]};
  window.state={page:'record-reader',selected:record.id,book:{id:id(),entries:[record],projects:[],notebooks:[]},projectOwner:null,storage:{contextId:id(),researchStorage:'catalogue',researchFormatVersion:21}};
  window.evidence=Array.from({length:22},(_,index)=>({kind:'artifact',id:id(),revision:(index+1).toString(16).padStart(64,'0'),title:'Original observation '+index,dependencyStatus:'unchecked',changed:[],changedCount:null,file:{name:'reading-'+index+'.txt',size:12,sha256:'f'.repeat(64)},...(index===1?{figureState:'edited'}:{})}));
  window.requests=[];window.errors=[];window.paintCount=0;window.extras=[];
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const showDialog=html=>{paintCount++;const dialog=document.getElementById('dialog');dialog.innerHTML=html;if(!dialog.open)dialog.showModal();};
  window.ui=researchMaterialsUI({state,esc,field:(label,control)=>'<label>'+label+control+'</label>',showDialog,notify:message=>errors.push(message),dirty(){},render(){},revisions:()=>({[record.id]:'a'.repeat(64)}),create(){},api:async(path,body={},options={})=>{
   const name=path.split('/').at(-1);
   if(name==='overview'){if(window.failNextOverview){window.failNextOverview=false;throw Error('Page interrupted');}return {items:structuredClone(body.cursor?evidence.slice(20):evidence.slice(0,20)),next:body.cursor?null:'older',imports:[],importsNext:null,changed:false};}
   if(name==='dependency-review')return new Promise((resolve,reject)=>{const request={body:structuredClone(body),options,resolve,reject,aborted:false};options.signal.addEventListener('abort',()=>{request.aborted=true;});requests.push(request);});
   if(name==='dataset-jobs'&&holdExtras)return new Promise(resolve=>extras.push(()=>resolve({items:[],next:null})));
   if(['dataset-jobs','drafts','association-list'].includes(name))return {items:[],next:null};
   const item=evidence.find(value=>value.id===body.ref?.id);
   let value;if(name==='read')value={...item,recordId:record.id,createdAt:'2026-10-01T12:00:00.000Z',content:{size:12,sha256:'f'.repeat(64),provenance:'Disposable observation',inputs:[]}};
   else if(name==='correction-status')value={retired:false,current:body.ref};
   else throw Error('Unexpected evidence API '+name);
   return path.includes('/material-reference/')?{value,namespaceId:state.book.id,projectId:null,labBookId:null}:value;
  }});
  window.complete=(index,statuses=[])=>requests[index].resolve({items:requests[index].body.refs.map((ref,position)=>({...ref,dependencyStatus:statuses[position]??'checked',changed:[],changedCount:statuses[position]==='unavailable'||statuses[position]==='stale'?null:0}))});
  window.report=(index,value)=>requests[index].options.onProgress(value);
  window.openEvidence=()=>ui.action({dataset:{action:'material-open',readonly:String(readonly)}});
  document.addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(!control)return;event.preventDefault();void ui.action(control).catch(error=>errors.push(error.message));});
  document.querySelector('main').innerHTML=ui.view(record,{readonly});
 },{readonly,holdExtras});
 await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();
 await expect(page.locator('.material-list > li')).toHaveCount(20);
 await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(1);
}

test('evidence paints before source checks or unfinished work, with usable inspection and paging',async({page})=>{
 await fixture(page,{holdExtras:true});const dialog=page.locator('#dialog'),rows=dialog.locator('.material-list > li');
 await expect(rows.first().getByRole('button',{name:'Inspect',exact:true})).toBeEnabled();await expect(rows.first().getByRole('link',{name:'Download reading-0.txt',exact:true})).toHaveAttribute('download','reading-0.txt');
 await expect(dialog.getByRole('button',{name:'Older evidence',exact:true})).toBeEnabled();await expect(dialog).toContainText('Loading unfinished work');await expect(rows.nth(1)).toContainText('record figure was edited');
 await expect(dialog.getByText('Sources checked. No newer or unavailable inputs found.',{exact:true})).toHaveCount(0);
 const firstNode=await rows.first().elementHandle(),paints=await page.evaluate(()=>paintCount);
 await page.evaluate(()=>report(0,{stage:'checking-evidence-references',completed:123}));await expect(dialog.locator('[data-dependency-progress]')).toContainText('123 examined');await expect(dialog.locator('[data-dependency-meter]')).not.toHaveAttribute('value',/.+/);
 expect(await page.evaluate(node=>node===document.querySelector('.material-list > li'),firstNode)).toBe(true);expect(await page.evaluate(()=>paintCount)).toBe(paints);
 await rows.first().getByRole('button',{name:'Inspect',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Original observation 0',exact:true})).toBeVisible();expect(await page.evaluate(()=>requests[0].aborted)).toBe(true);
 await page.evaluate(()=>{report(0,{stage:'checking-evidence-references',completed:999});complete(0);});await expect(dialog.getByRole('heading',{name:'Original observation 0',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await expect(rows).toHaveCount(20);await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(2);
 await dialog.getByRole('button',{name:'Older evidence',exact:true}).click();await expect(rows).toHaveCount(2);await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(3);expect(await page.evaluate(()=>requests[1].aborted)).toBe(true);
 await page.evaluate(()=>{complete(1);report(2,{stage:'reviewing-evidence-dependencies',completed:1,total:2});});await expect(dialog.locator('[data-dependency-progress]')).toContainText('1 of 2');await page.evaluate(()=>complete(2));await expect(rows.locator('[data-dependency-status="checked"]')).toHaveCount(2);
 expect(await page.evaluate(()=>requests.every(request=>request.body.refs.length<=50&&request.options.adopt===false))).toBe(true);expect(await page.evaluate(()=>errors)).toEqual([]);await firstNode.dispose();
});

test('reader source review reports stale, unavailable and failed states with retry and cancellation',async({page})=>{
 await fixture(page,{readonly:true});const dialog=page.locator('#dialog'),rows=dialog.locator('.material-list > li');
 await page.evaluate(()=>complete(0,['stale','unavailable']));await expect(rows.first()).toContainText('evidence changed');await expect(rows.nth(1)).toContainText('could not be checked');await expect(rows.locator('[data-dependency-status="checked"]')).toHaveCount(18);
 await expect(dialog.getByRole('button',{name:'Refresh evidence',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Retry source check',exact:true}).click();await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(2);expect(await page.evaluate(()=>requests[1].body.refs.length)).toBe(1);
 await page.evaluate(()=>requests[1].reject(Error('Interrupted check')));await expect(rows.nth(1)).toContainText('Retry the check');await dialog.getByRole('button',{name:'Retry source check',exact:true}).click();await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(3);
 await dialog.getByRole('button',{name:'Stop source check',exact:true}).click();await expect(rows.nth(1)).toContainText('Unfinished checks remain unchecked');expect(await page.evaluate(()=>requests[2].aborted)).toBe(true);
 await page.evaluate(()=>{report(2,{stage:'checking-evidence-references',completed:888});complete(2);});
 await expect(rows.nth(1).locator('[data-dependency-status]')).toHaveAttribute('data-dependency-status','cancelled');
 await dialog.getByRole('button',{name:'Refresh evidence',exact:true}).click();await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(4);await expect(rows).toHaveCount(20);
 await page.evaluate(()=>{state.projectOwner={projectId:crypto.randomUUID()};ui.view();});expect(await page.evaluate(()=>requests[3].aborted)).toBe(true);
 await page.evaluate(()=>{report(3,{stage:'checking-evidence-references',completed:777});complete(3);});await expect(rows.locator('[data-dependency-status="checked"]')).toHaveCount(0);expect(await page.evaluate(()=>errors)).toEqual([]);
});

test('invalid reviews and failed evidence paging remain retryable, and closing ignores late progress',async({page})=>{
 await fixture(page,{readonly:true});const dialog=page.locator('#dialog');
 await page.evaluate(()=>requests[0].resolve({items:requests[0].body.refs.map(ref=>({...ref,id:crypto.randomUUID(),dependencyStatus:'checked',changed:[],changedCount:0}))}));
 await expect(dialog.locator('[data-dependency-status="failed"]')).toHaveCount(20);await dialog.getByRole('button',{name:'Retry source check',exact:true}).click();await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(2);
 await page.evaluate(()=>window.failNextOverview=true);await dialog.getByRole('button',{name:'Older evidence',exact:true}).click();
 await expect(dialog.locator('[data-dependency-status="cancelled"]')).toHaveCount(20);await expect.poll(()=>page.evaluate(()=>errors)).toEqual(['Page interrupted']);expect(await page.evaluate(()=>requests[1].aborted)).toBe(true);
 await dialog.getByRole('button',{name:'Retry source check',exact:true}).click();await expect.poll(()=>page.evaluate(()=>requests.length)).toBe(3);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).not.toBeVisible();expect(await page.evaluate(()=>requests[2].aborted)).toBe(true);
 await page.evaluate(()=>{report(2,{stage:'checking-evidence-references',completed:555});complete(2);});await expect(dialog).not.toBeVisible();expect(await page.evaluate(()=>errors)).toEqual(['Page interrupted']);
});
