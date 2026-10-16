import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function fixture(page){
 const namespaces=new Set(['operationProgress','storageProgress','activity']);
 await page.route('http://progress.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<header><div data-activity-slot></div></header><main id="main"><h1>Storage</h1></main>'});
  let body=await readFile(new URL('../../src/web'+pathname.replace('/locales/nb/','/locales/en/'),import.meta.url),'utf8');
  if(pathname==='/locales/catalogues.json')body=JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(body)).map(ns=>[ns,namespaces.has(ns)?['en','nb']:['en']])));
  if(pathname.startsWith('/locales/nb/'))body=JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(body)).map(([key,value])=>[key,typeof value==='string'?'[nb] '+value:Object.fromEntries(Object.entries(value).map(([form,label])=>[form,'[nb] '+label]))])));
  await route.fulfill({contentType:pathname.endsWith('.json')?'application/json':pathname.endsWith('.css')?'text/css':'text/javascript',body});
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
 await page.screenshot({path:test.info().outputPath('operation-sequence.png'),fullPage:true});
 await page.evaluate(()=>progress.close());
});


test('activity stays in the shell header without covering Save controls and hides its empty index',async({page})=>{
 await fixture(page);
 for(const stylesheet of ['/app.css','/operation-progress.css','/shell-navigation.css'])await page.addStyleTag({url:stylesheet});
 await page.evaluate(async()=>{
  document.body.innerHTML='<div id="app"></div>';document.documentElement.dataset.navigation='left';
  const {applicationShell}=await import('/application-shell.js'),{shellNavigation}=await import('/shell-navigation.js'),{activityUI}=await import('/activity-ui.js');
  window.i18n=await import('/i18n/index.js');const navigation=shellNavigation();
  const content=()=>'<div class="page-heading"><h1>'+(location.hash==='#/preferences/storage'?'Storage':'Calculator')+'</h1></div><label>Calculation<input value="2 + 2"></label><div style="min-height:110vh"></div><div class="section-save"><span>Unsaved changes</span><button class="button primary" data-save>Save calculation</button></div>';
  window.shell=applicationShell({root:document.querySelector('#app'),mark:'',navigation:{update(sidebar,header){if(!header.querySelector('.workspace-heading')){const heading=document.createElement('div');heading.className='workspace-heading';heading.innerHTML='<button class="workspace-identity"><span class="workspace-name">A workspace with a long display name</span></button>';header.append(heading);}return false;},unmount(){}},applyLayout:()=>navigation.apply('module')});
  window.renderPage=()=>{shell.showWorkspace(content);activity.bind();};
  window.snapshot={contextId:'fixture',busy:false,readable:true,operations:[]};
  const fetchOriginal=window.fetch;window.fetch=(...args)=>args[0]==='/api/activity'?Promise.resolve(new Response(JSON.stringify(snapshot))):args[0]==='/api/activity/clear'?(snapshot.operations=[],Promise.resolve(new Response('{}'))):fetchOriginal(...args);
  window.activity=activityUI();shell.showWorkspace(content);await activity.refresh();
  window.activityHost=document.querySelector('.app-activity');window.saveCount=0;
  document.addEventListener('click',event=>{if(event.target.matches('[data-save]'))saveCount++;});
  window.addEventListener('hashchange',renderPage);
 });
 const activity=page.locator('.app-activity'),toggle=activity.locator('[data-toggle]'),panel=page.locator('#app-activity-panel'),save=page.locator('[data-save]');
 await expect(activity).toBeHidden();await expect(page.locator('.topbar [data-activity-slot] .app-activity')).toHaveCount(1);
 await page.evaluate(async()=>{
  snapshot.busy=true;snapshot.operations=[{id:'copy',kind:'/api/storage/copy',state:'running',startedAt:1,progress:{stage:'verify-snapshots',completed:3,total:100,unit:'snapshots'}},{id:'record',kind:'/api/research/records/writing/save',view:'#/preferences/general',state:'queued',startedAt:2,progress:{stage:'waiting-writer'}}];await activity.refresh();
 });
 await expect(toggle).toHaveText('Activity (1 running, 1 queued)');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:844});
  for(const direction of ['left','right','top']){
   await page.evaluate(direction=>{document.documentElement.dataset.navigation=direction;renderPage();},direction);
   await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();
   const geometry=await page.evaluate(()=>{
    const header=document.querySelector('.topbar').getBoundingClientRect(),activity=document.querySelector('.app-activity [data-toggle]').getBoundingClientRect(),save=document.querySelector('[data-save]').getBoundingClientRect();
    return {contained:activity.top>=header.top&&activity.bottom<=header.bottom,above:activity.bottom<=save.top,reachable:document.elementFromPoint(save.x+save.width/2,save.y+save.height/2)===document.querySelector('[data-save]'),overflow:document.documentElement.scrollWidth>innerWidth};
   });expect(geometry).toEqual({contained:true,above:true,reachable:true,overflow:false});await save.click();
   await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(panel.locator('h2')).toBeFocused();
   const bounds=await panel.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
   await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(toggle).toBeFocused();
  }
  await page.screenshot({path:test.info().outputPath('activity-header-'+width+'.png')});
 }
 expect(await page.evaluate(()=>saveCount)).toBe(6);
 await page.evaluate(async()=>{await i18n.prepareLanguage('nb');i18n.activateLanguage('nb');});await expect(toggle).toContainText('[nb] Activity');
 await toggle.click();await expect(panel.locator('h2')).toHaveText('[nb] Activity');
 await panel.locator('[data-operation="copy"] [data-owner]').click();await expect(page).toHaveURL(/#\/preferences\/storage$/);await expect(panel).toBeHidden();
 await expect(page.locator('#main [data-owned-activity] .operation-progress')).toHaveCount(1);
 expect(await page.evaluate(()=>activityHost===document.querySelector('.app-activity'))).toBe(true);
 await page.evaluate(async()=>{for(const entry of snapshot.operations)entry.state='completed';snapshot.busy=false;await activity.refresh();});
 await expect(page.locator('#main [data-owned-activity] .operation-progress')).toHaveCount(0);
 await toggle.click();await panel.locator('[data-clear]').click();await expect(panel.locator('[data-empty]')).toBeVisible();
 await panel.locator('[data-close]').click();await expect(activity).toBeHidden();await expect(page.locator('[data-action="shell-menu"]')).toBeFocused();
 await page.evaluate(()=>activity.stop());
});
