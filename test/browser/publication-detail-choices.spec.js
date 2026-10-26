import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('edition detail choices persist for current and retained records without changing inventory defaults',async({page})=>{
 await page.route('https://edition-details.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  await route.fulfill({contentType:pathname==='/'?'text/html':pathname.endsWith('.json')?'application/json':'text/javascript',body:pathname==='/'?'<dialog id="dialog"></dialog>':await readFile(new URL('../../src/web'+pathname,import.meta.url),'utf8')});
 });
 await page.goto('https://edition-details.test/');
 await page.evaluate(async()=>{
  const {publicationSelectionUI}=await import('/publication-selection-ui.js'),{validEditionRecord}=await import('/publication-selection.js');
  const id=()=>crypto.randomUUID(),revision=letter=>letter.repeat(64),esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const inventory=(title,rev)=>{const recordId=id();return {id:recordId,title,notebook:'Instrument checks',sections:[],fields:[],attachments:[],figures:[],choice:{id:recordId,revision:rev,include:true,body:true,sections:[],fields:[],attachments:[],figures:[]}};};
  window.records=[inventory('Current observation',revision('a')),inventory('Another observation',revision('c'))];
  window.historical={...structuredClone(records[0]),title:'Earlier observation',pageId:id(),choice:{...structuredClone(records[0].choice),revision:revision('b')}};
  window.originalInventory=JSON.stringify([records,historical]);window.checkpoints=[];window.saved=new Map();window.errors=[];window.prepared=[];
  const state={storage:{contextId:id()},websiteId:id(),websitePin:{websiteId:id()}},source={websiteId:state.websiteId};
  let generation=1,selection={version:2,id:id(),revision:generation.toString(16).padStart(64,'0'),source:revision('d')};
  const key=value=>value.collection+':'+value.id;
  const api=async(path,body)=>{
   if(path==='/api/publication-selections/open')return {selection};
   if(path==='/api/publication-selections/read')return {selection,items:body.keys.map(item=>({...item,value:structuredClone(saved.get(key(item))??null)}))};
   if(path==='/api/publication-selections/checkpoint'){
    checkpoints.push(structuredClone(body));for(const change of body.changes){if(['records','history'].includes(change.collection)&&change.value&&!validEditionRecord(change.value))throw Error('Invalid saved edition choice');if(change.value)saved.set(key(change),structuredClone(change.value));else saved.delete(key(change));}
    selection={...selection,revision:(++generation).toString(16).padStart(64,'0')};return {selection};
   }
   if(path==='/api/publication-selection')return {items:[structuredClone(records[body.offset?1:0])],offset:body.offset,next:body.offset?null:20,nextCursor:body.offset?null:'next-record-page'};
   if(path==='/api/publication-references')return {items:[{target:{workspaceId:state.storage.contextId,kind:'record',id:historical.id,revision:historical.choice.revision},record:structuredClone(historical),preview:{body:'Earlier retained writing',sections:[],fields:[]}}],offset:0,next:null};
   throw Error('Unexpected edition API '+path);
  };
  window.ui=publicationSelectionUI({state,api,esc,showDialog:html=>{const dialog=document.getElementById('dialog');dialog.innerHTML=html;if(!dialog.open)dialog.showModal();}});
  document.addEventListener('input',event=>ui.input(event.target));
  document.addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(control){event.preventDefault();void ui.action(control).catch(error=>errors.push(error.message));}});
  window.reopen=()=>ui.open(source,value=>prepared.push(value));await reopen();
 });
 const dialog=page.locator('#dialog'),current=dialog.locator('[data-edition-record]').first();
 const labels=['Preparation input labels, hashes and references','Preparation and execution history: conditions, actors, sources, timestamps, events and assessments','Related-record links','Contributor credits','Result statements and supporting provenance'];
 await current.locator(':scope > summary').click();
 for(const label of labels)await expect(current.getByLabel(label,{exact:true})).toBeChecked();
 await current.getByLabel(labels[0],{exact:true}).uncheck();await current.getByLabel(labels[1],{exact:true}).uncheck();
 await dialog.getByRole('button',{name:'Next records',exact:true}).click();await expect(dialog).toContainText('Another observation');
 await dialog.getByRole('button',{name:'Previous records',exact:true}).click();await expect(current).toContainText('Current observation');await current.locator(':scope > summary').click();
 await expect(current.getByLabel(labels[0],{exact:true})).not.toBeChecked();await expect(current.getByLabel(labels[1],{exact:true})).not.toBeChecked();
 await current.getByRole('button',{name:'Review referenced revisions',exact:true}).click();
 const history=current.locator('[data-edition-history]');await history.locator(':scope > summary').click();await history.getByLabel('Include this record',{exact:true}).check();
 for(const label of labels){await expect(history.getByLabel(label,{exact:true})).toBeChecked();await history.getByLabel(label,{exact:true}).uncheck();}
 await dialog.getByRole('button',{name:'Next records',exact:true}).click();await dialog.getByRole('button',{name:'Previous records',exact:true}).click();
 await current.locator(':scope > summary').click();await current.getByRole('button',{name:'Review referenced revisions',exact:true}).click();await history.locator(':scope > summary').click();
 await expect(history.getByLabel('Include this record',{exact:true})).toBeChecked();for(const label of labels)await expect(history.getByLabel(label,{exact:true})).not.toBeChecked();
 const currentDetails=current.locator(':scope > [data-edition-parts] [data-edition-choice="details"]');await expect(currentDetails).toHaveCount(5);
 expect(await currentDetails.evaluateAll(nodes=>nodes.filter(node=>node.checked).map(node=>node.value))).toEqual(['relations','contributors','results']);
 await dialog.getByRole('button',{name:'Back to editing',exact:true}).click();await page.evaluate(()=>reopen());await current.locator(':scope > summary').click();
 await expect(current.getByLabel(labels[0],{exact:true})).not.toBeChecked();await expect(current.getByLabel(labels[1],{exact:true})).not.toBeChecked();
 await current.getByLabel(labels[0],{exact:true}).check();await current.getByLabel(labels[1],{exact:true}).check();await dialog.getByRole('button',{name:'Back to editing',exact:true}).click();
 const result=await page.evaluate(()=>({current:saved.get('records:'+records[0].id),other:saved.get('records:'+records[1].id),history:saved.get('history:'+historical.id+':'+historical.choice.revision),unchanged:originalInventory===JSON.stringify([records,historical]),errors,checkpoints}));
 expect(result.current).toBeUndefined();expect(result.other).toBeUndefined();expect(result.history.details).toEqual([]);expect(result.unchanged).toBe(true);expect(result.errors).toEqual([]);expect(result.checkpoints.some(request=>request.changes.some(change=>change.value?.details?.length===3))).toBe(true);
});
