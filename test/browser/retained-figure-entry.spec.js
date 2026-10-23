import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function fixture(page){
 await page.route('https://figure-entry.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;return route.fulfill({contentType:pathname==='/'?'text/html':pathname.endsWith('.json')?'application/json':'text/javascript',body:pathname==='/'?'<main></main><dialog id="dialog"></dialog>':await readFile(new URL('../../src/web'+pathname,import.meta.url),'utf8')});});
 await page.goto('https://figure-entry.test/');await page.evaluate(async()=>{
  const {researchMaterialsUI}=await import('/research-materials-ui.js'),id=()=>crypto.randomUUID();window.record={id:id(),title:'Figure owner',figures:[]};window.state={page:'record-reader',selected:record.id,book:{id:id(),entries:[record]},projectOwner:null,storage:{contextId:id(),researchStorage:'catalogue',researchFormatVersion:21}};window.references={first:{kind:'record',id:record.id,workspaceId:state.book.id,revision:'a'.repeat(64)},second:{kind:'record',id:record.id,workspaceId:state.book.id,revision:'b'.repeat(64)}};window.currentRevision=references.second.revision;window.resultTargets=[];window.figureId=id();const plotId=id(),seriesId=id(),pointId=id();window.calls=[];window.errors=[];window.hold=false;window.release=null;window.dialogWasOpen=[];
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),showDialog=html=>{const dialog=document.getElementById('dialog');dialog.innerHTML=html;if(!dialog.open)dialog.showModal();};
  window.ui=researchMaterialsUI({state,currentRecordRevision:()=>currentRevision,showFigureResults:id=>resultTargets.push(id),esc,field:(label,control)=>'<label>'+label+control+'</label>',showDialog,notify:message=>errors.push(message),dirty(){},render(){},revisions:()=>({[record.id]:references.second.revision}),create(){},api:async(path,body)=>{
   const name=path.split('/').at(-1);calls.push({name,body:structuredClone(body)});
   if(name==='source-resolve'){dialogWasOpen.push(document.getElementById('dialog').open);if(hold&&body.ref.revision===references.first.revision)await new Promise(resolve=>release=resolve);return {workspaceId:state.book.id,reference:body.ref,owner:{workspaceId:state.book.id,projectId:null,labBookId:null},title:'Pinned record'};}
   if(name!=='retained-figure')throw Error('Unexpected '+name);const revision=body.ref.revision;let value;
   if(body.operation==='header')value={header:{kind:'line',title:'Pinned '+revision[0],x:{label:'X'},y:{label:'Y'}},counts:{series:1}};
   else if(body.operation==='svg')value={svg:'<svg data-pinned="'+revision+'"><text>Pinned '+revision[0]+'</text></svg>'};
   else if(body.operation==='window'){const collection=body.selection.collection;value={items:collection==='panels'?[{plotId,value:{plotId}}]:collection==='series'?[{id:seriesId,position:0,value:{name:'Series '+revision[0]}}]:[{id:pointId,position:0,value:{x:'Reading',y:1}}],total:1,next:null};}
   else throw Error('Unexpected figure operation');return {value:{...value,revision},namespaceId:state.book.id,projectId:null,labBookId:null};
  }});
  window.openFigure=ref=>ui.action({dataset:{action:'material-retained-figure',recordId:record.id,figureId,figureRef:JSON.stringify(ref)}});
 });
}
test('retained figure opens from a closed main-reader dialog and pins every request and download',async({page})=>{
 await fixture(page);expect(await page.locator('#dialog').evaluate(node=>node.open)).toBe(false);await page.evaluate(()=>openFigure(references.first));await expect(page.locator('[data-pinned]')).toHaveAttribute('data-pinned','a'.repeat(64));
 const evidence=await page.evaluate(()=>({calls,errors,dialogWasOpen,ref:references.first,figureId}));expect(evidence.dialogWasOpen).toEqual([true]);expect(evidence.errors).toEqual([]);const reads=evidence.calls.filter(call=>call.name==='retained-figure');expect(reads.length).toBe(5);for(const [index,call]of reads.entries()){expect(call.body.ref).toEqual(evidence.ref);expect(call.body.figureId).toBe(evidence.figureId);if(index)expect(call.body.expectedRevision).toBe(evidence.ref.revision);expect(call.body).not.toHaveProperty('document');}
 for(const href of await page.locator('#dialog a[download]').evaluateAll(nodes=>nodes.map(node=>node.href))){const selected=JSON.parse(new URL(href).searchParams.get('selection'));expect(selected.ref).toEqual(evidence.ref);expect(selected.expectedRevision).toBe(evidence.ref.revision);}
});
test('late retained-source authorization cannot mount over a replacement figure view',async({page})=>{
 await fixture(page);await page.evaluate(()=>{hold=true;window.pending=openFigure(references.first).catch(error=>errors.push(error.name));});await expect.poll(()=>page.evaluate(()=>typeof release)).toBe('function');await page.evaluate(()=>openFigure(references.second));await page.evaluate(async()=>{release();await pending;});await expect(page.locator('[data-pinned]')).toHaveAttribute('data-pinned','b'.repeat(64));expect(await page.evaluate(()=>errors)).toEqual(['AbortError']);expect(await page.evaluate(()=>calls.filter(call=>call.name==='retained-figure'&&call.body.ref.revision===references.first.revision))).toEqual([]);
});

test('panel results belong only to the exact current record and are rechecked before navigation',async({page})=>{
 await fixture(page);await page.evaluate(()=>openFigure(references.first));await expect(page.locator('[data-rf="results"]')).toHaveCount(0);
 await page.evaluate(()=>openFigure(references.second));await expect(page.locator('[data-rf="results"]')).toHaveText('Results for Pinned b');
 await page.evaluate(()=>currentRevision=references.first.revision);await page.locator('[data-rf="results"]').click();expect(await page.evaluate(()=>resultTargets)).toEqual([]);await expect(page.locator('#dialog')).toBeVisible();
 await page.evaluate(()=>{currentRevision=references.second.revision;return openFigure(references.second);});await page.locator('[data-rf="results"]').click();expect(await page.evaluate(()=>resultTargets.length)).toBe(1);await expect(page.locator('#dialog')).not.toBeVisible();
});
