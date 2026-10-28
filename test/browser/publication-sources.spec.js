import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function fixture(page){
 await page.route('https://publication-sources.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<main id="main"></main>'});
  const body=await readFile(new URL('../../src/web'+pathname,import.meta.url),'utf8');await route.fulfill({contentType:pathname.endsWith('.json')?'application/json':'text/javascript',body});
 });
 await page.goto('https://publication-sources.test/');
 await page.evaluate(async()=>{
  const {publicationSourcesUI}=await import('/publication-sources-ui.js');const id=()=>crypto.randomUUID();
  window.state={page:'website',book:{id:id(),website:{}},etag:'a'.repeat(64),storage:{contextId:'host'},access:{locked:false}};
  window.owners=['First project','Second project'].map(label=>({workspaceId:id(),projectId:id(),labBookId:null,kind:'project',label,ancestors:[]}));
  const notebook=id(),records=Array.from({length:25},(_,i)=>({id:id(),title:'Observation '+String(i).padStart(2,'0'),notebookId:notebook,type:'note',share:true,attachmentCount:1})),attachment=id();
  window.notebook=notebook;window.ids=records.map(r=>r.id);window.changes=0;window.messages=[];window.calls=[];window.requests=[];
  const api=async(route,body,options)=>{
   calls.push({route,body,adopt:options.adopt});requests.push(options.signal);
   if(route.endsWith('publication-source-directory')){const items=body.projectId?[{...owners.find(o=>o.projectId===body.projectId),kind:'content'}]:owners;return {workspaceId:state.book.id,projectId:body.projectId,revision:'d'.repeat(64),items,offset:0,total:items.length};}
   const owner=owners.find(o=>o.workspaceId===body.sourceId),identity={workspaceId:owner.workspaceId,projectId:owner.projectId,labBookId:owner.labBookId};
   let value={workspaceId:owner.workspaceId,snapshotId:'b'.repeat(64)};
   if(body.operation==='head')value={...value,title:owner.label,projects:[{id:owner.projectId,title:owner.label,share:true,parentId:null}],notebooks:[{id:notebook,title:'Measurements',projectId:owner.projectId}]};
   else if(body.operation==='content'){
    if(window.delay){window.pending=true;await new Promise(resolve=>window.release=resolve);}
    const items=records.filter(r=>r.title.includes(body.query.search)),offset=Number(body.query.cursor??0);value={...value,total:items.length,offset,items:items.slice(offset,offset+10),previousCursor:offset?String(Math.max(0,offset-10)):null,nextCursor:offset+10<items.length?String(offset+10):null};
   }else if(body.operation==='record')value={...value,record:{...records.find(r=>r.id===body.query.recordId),attachments:[{id:attachment,kind:'image',caption:'Observation photo',alt:'',share:true}]}};
   else if(body.operation==='summary')value={...value,selectionProjects:Object.fromEntries(body.query.selection.records.map(r=>[r.id,owner.projectId]))};
   return {owner:identity,value};
  };
  const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  window.controls=publicationSourcesUI({state,api,esc,access:run=>run(),checkpoint:()=>{},changed:()=>changes++,notify:message=>messages.push(message)});
  document.querySelector('main').innerHTML=controls.view();controls.bind();
 });
}
async function open(page,index=0){await page.locator('[data-source-action="open"]').nth(index).click();await page.getByRole('button',{name:'Choose content',exact:true}).click();await expect(page.locator('[data-source-record]')).toHaveCount(10);}

test('source choices page independently, preserve copied IDs and never write while browsing',async({page})=>{
 await fixture(page);await open(page);
 expect(await page.evaluate(()=>changes)).toBe(0);expect(await page.evaluate(()=>calls.every(c=>c.adopt===false))).toBe(true);
 await page.locator('[data-source-record]').first().check();
 await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('[data-source-record]')).toHaveCount(10);
 await page.locator('[data-source-record]').first().check();
 await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(page.locator('[data-source-record]').first()).toBeChecked();
 await page.getByLabel('Include available records in this project',{exact:true}).check();await expect(page.locator('[data-source-record]')).toHaveCount(10);await expect(page.locator('[data-source-record]').last()).toBeChecked();
 expect(await page.evaluate(()=>state.book.website.researchSources[0].selection.records)).toEqual([]);
 await page.getByLabel('Include available records in this project',{exact:true}).uncheck();await expect(page.locator('[data-source-record]').first()).not.toBeChecked();
 await page.locator('[data-source-record]').first().check();await page.getByRole('button',{name:'Media',exact:true}).first().click();await expect(page.getByLabel('Observation photo',{exact:true})).toBeChecked();await page.getByLabel('Observation photo',{exact:true}).uncheck();await expect(page.getByLabel('Observation photo',{exact:true})).not.toBeChecked();await page.getByLabel('Observation photo',{exact:true}).check();
 await page.getByRole('button',{name:'Choose a project or lab book',exact:true}).click();await open(page,1);await expect(page.locator('[data-source-record]').first()).not.toBeChecked();await page.locator('[data-source-record]').first().check();
 const sources=await page.evaluate(()=>state.book.website.researchSources);expect(sources).toHaveLength(2);expect(sources[0].workspaceId).not.toBe(sources[1].workspaceId);expect(sources[0].selection.records[0].id).toBe(sources[1].selection.records[0].id);expect(sources[1].selection.records[0].attachments).toEqual([]);
 await page.getByRole('button',{name:'Remove source',exact:true}).click();expect(await page.evaluate(()=>state.book.website.researchSources.length)).toBe(1);expect(await page.evaluate(()=>messages)).toEqual([]);
});

test('leaving during a source query cancels it and cannot create a pending edit',async({page})=>{
 await fixture(page);await open(page);await page.evaluate(()=>{window.delay=true;});
 await page.getByRole('button',{name:'Next',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.pending)).toBe(true);await expect(page.getByLabel('Include available records in this project',{exact:true})).toBeDisabled();
 await page.evaluate(()=>{state.page='module';controls.sync();document.querySelector('main').innerHTML='<h1>Another section</h1>';release();});
 await expect(page.getByRole('heading',{name:'Another section',exact:true})).toBeVisible();expect(await page.evaluate(()=>requests.at(-1).aborted)).toBe(true);expect(await page.evaluate(()=>changes)).toBe(0);expect(await page.evaluate(()=>state.book.website.researchSources)).toBeUndefined();
});


test('saved book consent remains visible and editable after its parent project changes',async({page})=>{
 await fixture(page);await page.evaluate(()=>{owners[0].kind='book';owners[0].labBookId=notebook;controls.close();controls.bind();});
 await page.getByRole('button',{name:'Choose content',exact:true}).click();await expect(page.locator('[data-source-record]')).toHaveCount(10);
 await page.getByLabel('Include available records in this lab book',{exact:true}).check();await expect(page.locator('[data-source-record]').first()).toBeChecked();await page.locator('[data-source-record]').first().uncheck();
 const saved=await page.evaluate(()=>structuredClone(state.book.website.researchSources));expect(saved[0].labBookId).toBe(await page.evaluate(()=>notebook));
 await page.evaluate(()=>{owners[0].projectId=crypto.randomUUID();controls.close();controls.bind();});await page.getByRole('button',{name:'Choose content',exact:true}).click();await expect(page.locator('[data-source-record]')).toHaveCount(10);
 await expect(page.getByLabel('Include available records in this lab book',{exact:true})).toBeChecked();await expect(page.locator('[data-source-record]').first()).not.toBeChecked();await expect(page.locator('[data-source-record]').nth(1)).toBeChecked();expect(await page.evaluate(()=>state.book.website.researchSources)).toEqual(saved);
 await page.locator('[data-source-record]').nth(1).uncheck();expect(await page.evaluate(()=>state.book.website.researchSources[0].projectIds)).toEqual(await page.evaluate(()=>[owners[0].projectId]));expect(await page.evaluate(()=>state.book.website.researchSources[0].selection.records.filter(record=>record.share===false).length)).toBe(2);expect(await page.evaluate(()=>messages)).toEqual([]);
});
