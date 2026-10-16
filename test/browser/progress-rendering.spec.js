import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function fixture(page){
 const namespaces=new Set(['operationProgress','storageProgress','activity']);
 await page.route('http://progress.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<main id="main"><h1>Storage</h1></main>'});
  let body=await readFile(new URL('../../src/web'+pathname.replace('/locales/nb/','/locales/en/'),import.meta.url),'utf8');
  if(pathname==='/locales/catalogues.json')body=JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(body)).map(ns=>[ns,namespaces.has(ns)?['en','nb']:['en']])));
  if(pathname.startsWith('/locales/nb/'))body=JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(body)).map(([key,value])=>[key,typeof value==='string'?'[nb] '+value:Object.fromEntries(Object.entries(value).map(([form,label])=>[form,'[nb] '+label]))])));
  await route.fulfill({contentType:pathname.endsWith('.json')?'application/json':'text/javascript',body});
 });
 await page.goto('http://progress.test/');await page.clock.install();
}

test('progress patches measured fields only; clock and language have independent update paths',async({page})=>{
 await fixture(page);
 await page.evaluate(async()=>{
  const {operationProgress}=await import('/operation-progress-ui.js'),{storageProgressPresentation}=await import('/storage-progress-presentation.js');
  window.i18n=await import('/i18n/index.js');window.stageCalls=0;window.presentations=0;
  window.progress=operationProgress({host:document.querySelector('main'),compact:true,scroll:false,disableControls:false,title:()=>i18n.t('operationProgress','title'),hint:()=>i18n.t('operationProgress','details'),stageText:key=>{stageCalls++;return i18n.t('storageProgress',key);},presentation:value=>{presentations++;return storageProgressPresentation(value);}});
  window.value={stage:'verify-snapshots',stages:['copy-workspace','verify-snapshots'],item:'retained revision',completed:2,total:571,unit:'snapshots',elapsedMs:5000,observedAt:100,advancedAt:100};progress.update(value);
  window.nodes=[...progress.element.querySelectorAll('*')];window.mutations=[];window.observe=new MutationObserver(records=>mutations.push(...records.map(r=>({target:r.target.nodeType===3?r.target.parentElement:r.target,type:r.type,attribute:r.attributeName}))));observe.observe(progress.element,{subtree:true,childList:true,characterData:true,attributes:true});
 });
 const region=page.locator('.operation-progress');await region.locator('summary').click();await region.locator('[data-item]').focus();
 await page.evaluate(()=>{mutations=[];window.baseline={stageCalls,presentations};for(let i=3;i<20;i++)progress.update({...value,completed:i});});
 expect(await page.evaluate(()=>mutations.map(r=>r.target.matches('[data-count],progress')))).not.toContain(false);
 expect(await page.evaluate(()=>stageCalls-baseline.stageCalls)).toBe(0);
 expect(await page.evaluate(()=>nodes.every((node,i)=>progress.element.querySelectorAll('*')[i]===node))).toBe(true);
 await expect(region.locator('details')).toHaveAttribute('open','');await expect(region.locator('[data-item]')).toBeFocused();
 await page.evaluate(()=>{mutations=[];window.baseline={stageCalls,presentations};});await page.clock.fastForward(2000);
 expect(await page.evaluate(()=>mutations.every(r=>r.target.matches('[data-time]')))).toBe(true);
 expect(await page.evaluate(()=>presentations-baseline.presentations)).toBe(0);
 await page.evaluate(async()=>{await i18n.prepareLanguage('nb');mutations=[];i18n.activateLanguage('nb');});
 await expect(region.locator('h3')).toContainText('[nb]');await expect(region.locator('summary')).toHaveText('[nb] Details');
 await expect(region.locator('[data-hint]')).toHaveText('[nb] Details');await expect(region).toHaveAttribute('aria-label','[nb] Operation progress');
 expect(await page.evaluate(()=>mutations.filter(r=>r.target.matches('h3')).length)).toBe(1);
 await page.evaluate(()=>{mutations=[];window.baseline={stageCalls,presentations};progress.update({...value,completed:20});});
 expect(await page.evaluate(()=>stageCalls-baseline.stageCalls)).toBe(0);expect(await page.evaluate(()=>mutations.some(r=>r.target.matches('h3,summary,[data-path],[data-work],[data-hint]')))).toBe(false);
 await page.evaluate(()=>{progress.update({...value,stage:'verify-history',unit:'records'});});await expect(region.locator('h3')).toContainText('Verifying record history');
 await page.evaluate(()=>{progress.close();mutations=[];window.baseline={stageCalls,presentations};i18n.activateLanguage('en');});await page.clock.fastForward(2000);
 expect(await page.evaluate(()=>presentations-baseline.presentations)).toBe(0);await expect(region).toHaveCount(0);
});

test('activity polling preserves cards, disclosure, focus and selection when only progress changes',async({page})=>{
 await fixture(page);
 await page.evaluate(async()=>{
  location.hash='#/preferences/storage';
  window.snapshot={contextId:'fixture',busy:true,readable:true,operations:[{id:'copy',kind:'/api/storage/copy',state:'running',startedAt:1,progress:{stage:'verify-snapshots',stages:['verify-copy','verify-snapshots'],completed:3,total:100,unit:'snapshots',elapsedMs:2000}}]};
  const fetchOriginal=window.fetch;window.fetch=(...args)=>args[0]==='/api/activity'?Promise.resolve(new Response(JSON.stringify(snapshot))):fetchOriginal(...args);
  const {activityUI}=await import('/activity-ui.js');window.activity=activityUI();await activity.refresh();
  window.cards=[...document.querySelectorAll('article')];window.mutations=[];window.observe=new MutationObserver(records=>mutations.push(...records));observe.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
 });
 await page.locator('#main summary').click();await page.locator('#main [data-path]').focus();
 await page.evaluate(()=>{const text=document.querySelector('#main .operation-progress h3').firstChild;window.selectedText=text;const range=document.createRange();range.selectNodeContents(text);getSelection().removeAllRanges();getSelection().addRange(range);mutations=[];});
 await page.evaluate(async()=>{await activity.refresh();});expect(await page.evaluate(()=>mutations.length)).toBe(0);
 await page.evaluate(async()=>{snapshot.operations[0].progress.completed++;await activity.refresh();});
 expect(await page.evaluate(()=>cards.every((node,i)=>document.querySelectorAll('article')[i]===node))).toBe(true);
 expect(await page.evaluate(()=>getSelection().anchorNode===selectedText)).toBe(true);
 await expect(page.locator('#main [data-path]')).toBeFocused();await expect(page.locator('#main details')).toHaveAttribute('open','');
 expect(await page.evaluate(()=>mutations.every(r=>r.target.matches('[data-count],progress')))).toBe(true);
 await page.evaluate(()=>activity.stop());await expect(page.locator('.app-activity')).toHaveCount(0);
});

test('verification keeps its place in a transfer when the revision bar completes and analysis begins',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:800});
 await page.addStyleTag({content:await readFile(new URL('../../src/web/operation-progress.css',import.meta.url),'utf8')});
 await page.evaluate(async()=>{
  const {operationProgress}=await import('/operation-progress-ui.js'),{storageProgressPresentation}=await import('/storage-progress-presentation.js'),{t}=await import('/i18n/index.js');
  window.progress=operationProgress({host:document.querySelector('main'),compact:true,scroll:false,disableControls:false,stageText:key=>t('storageProgress',key),presentation:storageProgressPresentation});
  const steps=names=>names.map(stage=>({stage,state:'pending'}));
  window.value={stage:'verify-snapshots',stages:['copy-workspace','verify-copy','verify-copy','verify-snapshots'],completed:571,total:571,unit:'snapshots',sequences:[{id:'copy-workspace',steps:steps(['copy-files','verify-copy','activate','remove-original'])},{id:'verify-copy',steps:steps(['verify-snapshots','verify-modules','verify-analysis','verify-reviews','verify-imports','verify-evidence','verify-collaboration','verify-media','verify-publication','verify-drafts','verify-run-receipts','verify-history'])}]};
  value.sequences[0].steps[0].state='completed';value.sequences[0].steps[1].state='running';value.sequences[1].steps[0].state='running';progress.update(value);
 });
 const sequences=page.locator('.operation-sequence');await expect(sequences).toHaveCount(2);
 await expect(sequences.first().locator('summary')).toContainText('step 2 of 4');
 await sequences.first().locator('summary').click();await sequences.last().locator('summary').click();
 await page.evaluate(()=>{
  window.rows=[...document.querySelectorAll('.operation-sequence li')];value.sequences[1].steps[0].state='completed';value.sequences[1].steps[1].state='completed';value.sequences[1].steps[2].state='running';
  value={...value,stage:'verify-analysis',stages:['copy-workspace','verify-copy','verify-copy','verify-analysis'],completed:0,unit:'items'};delete value.total;progress.update(value);
 });
 await expect(sequences.first().locator('summary')).toContainText('step 2 of 4');await expect(sequences.last().locator('summary')).toContainText('step 3 of 12');
 await expect(sequences.last().locator('li').nth(0)).toHaveAttribute('data-state','completed');
 await expect(sequences.last().locator('li').nth(2)).toHaveAttribute('aria-current','step');
 await expect(sequences.first().locator('li').nth(3)).toHaveAttribute('data-state','pending');
 expect(await page.evaluate(()=>rows.every((row,index)=>document.querySelectorAll('.operation-sequence li')[index]===row))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/operation-sequence-review.png',fullPage:true});
 await page.evaluate(()=>progress.close());
});
