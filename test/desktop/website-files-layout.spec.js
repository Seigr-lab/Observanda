import {test,expect} from '@playwright/test';
import {websiteDesktopFixture} from './installed-website-app.js';
import {createWebsiteWorkspace} from './website-workspace-fixture.js';
import english from '../../src/web/locales/en/websiteFiles.json' with {type:'json'};
import catalan from '../../src/web/locales/ca/websiteFiles.json' with {type:'json'};

const labels=[
 'Longitudinal measurements of flowering plants in experimental plots',
 'ObservationsThroughSuccessiveMeasurementIntervalsWithoutSeparators',
 'Summary of the independent replicate measurements'
];

test('scrolling the outline, page or inspector keeps the other desktop panes in place',async({},info)=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_EXECUTABLE&&process.env.OBSERVANDA_QUALIFY_SOURCE_WEBSITE!=='1','Requires an isolated desktop qualification.');
 test.setTimeout(180000);
 const fixture=await websiteDesktopFixture();let app;
 try{
  app=await fixture.start();const page=await app.firstWindow();
  await createWebsiteWorkspace(page,fixture.directory,'Authoring workspace');
  const id=await page.evaluate(async()=>{
   const {contextId}=await(await fetch('/api/storage')).json();
   const sections=Array.from({length:80},(_,i)=>'<section><h2>Sampling station '+(i+1)+'</h2><p>Replicates, instruments and field observations.</p></section>').join('');
   const response=await fetch('/api/website-files/create',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':contextId},body:JSON.stringify({name:'Survey handbook',html:'<!doctype html><html lang="en"><head><title>Survey handbook</title></head><body><main><h1>Survey handbook</h1>'+sections+'</main></body></html>'})});
   if(!response.ok)throw Error('Cannot prepare website: '+response.status);
   return (await response.json()).site.id;
  });
  await page.goto(new URL('/#/websites/'+id+'/editor',page.url()).href);
  const outline=page.locator('.website-files-editor>aside').first(),inspector=page.locator('.website-files-inspection'),list=page.locator('[data-website-files-structure]'),canvas=page.frameLocator('#website-files-canvas');
  await expect(canvas.getByRole('heading',{name:'Survey handbook'})).toBeVisible();
  const state=()=>page.evaluate(()=>{
   const frame=document.querySelector('#website-files-canvas');
   return {outer:document.scrollingElement.scrollTop,outerRange:document.scrollingElement.scrollHeight-innerHeight,outline:document.querySelector('.website-files-editor>aside').scrollTop,list:document.querySelector('[data-website-files-structure]').scrollTop,inspector:document.querySelector('.website-files-inspection').scrollTop,canvas:frame.contentDocument.scrollingElement.scrollTop};
  });
  for(const [width,height] of [[1440,900],[1148,759],[1280,800]]){
   await page.setViewportSize({width,height});await expect.poll(async()=>(await state()).outerRange).toBeLessThanOrEqual(1);
   expect(await list.evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');
  }
  await list.getByRole('button',{name:'Sampling station 1',exact:true}).hover();await page.mouse.wheel(0,320);
  await expect.poll(async()=>(await state()).outline).toBeGreaterThan(0);
  const left=await state();expect([left.outer,left.list,left.inspector,left.canvas]).toEqual([0,0,0,0]);
  await inspector.focus();await page.keyboard.press('PageDown');await expect.poll(async()=>(await state()).inspector).toBeGreaterThan(0);
  await canvas.getByRole('heading',{name:'Sampling station 2',exact:true}).hover();await page.mouse.wheel(0,310);
  await expect.poll(async()=>(await state()).canvas).toBeGreaterThan(0);
  const other=await state();expect(other.outer).toBe(0);expect(other.outline).toBe(left.outline);
  await outline.focus();await page.keyboard.press('End');await expect.poll(()=>outline.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThanOrEqual(1);
  await outline.hover();await page.mouse.wheel(0,600);const edge=await state();expect(edge.outer).toBe(0);expect(edge.canvas).toBe(other.canvas);
  await outline.focus();await page.keyboard.press('Home');await expect.poll(async()=>(await state()).outline).toBe(0);
  await canvas.getByRole('heading',{name:'Sampling station 1',exact:true}).click();
  if(process.env.OBSERVANDA_WEBSITE_LAYOUT_ARCHIVE==='1')await info.attach('desktop-scroll-ownership',{body:await page.screenshot(),contentType:'image/png'});
  await page.setViewportSize({width:760,height:500});
  for(const column of [outline,inspector,list])expect(await column.evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');
  await inspector.focus();await expect(inspector).toBeFocused();await expect(inspector).toBeInViewport();
 }finally{await fixture.dispose(app);}
});

test('page structure retains readable labels and keyboard actions in desktop windows',async({},info)=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_EXECUTABLE&&process.env.OBSERVANDA_QUALIFY_SOURCE_WEBSITE!=='1','Requires an isolated desktop qualification.');
 test.setTimeout(180000);
 const fixture=await websiteDesktopFixture(),metrics=[];
 let app,page,completed=false;
 try{
  app=await fixture.start(undefined,{expectedVersion:process.env.OBSERVANDA_WEBSITE_LAYOUT_VERSION});page=await app.firstWindow();
  await createWebsiteWorkspace(page,fixture.directory,'Layout study');
  const id=await page.evaluate(async labels=>{
   const {contextId}=await(await fetch('/api/storage')).json(),html='<!doctype html><html><body><main>'+labels.map(label=>'<section><h2>'+label+'</h2></section>').join('')+'</main></body></html>';
   const response=await fetch('/api/website-files/create',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':contextId},body:JSON.stringify({name:'Field observations',html})});
   const saved=await response.json();if(!response.ok)throw Error('Preparing the saved website failed: '+saved.code);return saved.site.id;
  },labels);
  await page.goto(new URL('/#/websites/'+id+'/editor',page.url()).href);
  const list=page.locator('[data-website-files-structure]'),rows=list.getByRole('listitem');
  for(const [language,words] of [['en',english],['ca',catalan]]){
   if(language==='ca'){
    const status=await page.evaluate(async()=>{
     const {contextId}=await(await fetch('/api/website-files/session')).json();
     return (await fetch('/api/language',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':contextId},body:JSON.stringify({language:'ca'})})).status;
    });
    expect(status).toBe(200);await page.reload();
   }
   await expect(page.getByRole('heading',{name:words.structure,exact:true})).toBeVisible();
   for(const viewport of [{width:1920,height:1080},{width:1280,height:800}]){
    await page.setViewportSize(viewport);await expect(rows).toHaveCount(labels.length);await page.evaluate(()=>document.fonts.ready);
    await rows.first().locator('[data-layer-select]').press('Enter');
    const layout=await list.evaluate(element=>{
     const round=n=>Math.round(n*10)/10;
     return {viewport:window.innerWidth,bodyWidth:document.documentElement.scrollWidth,listWidth:element.clientWidth,listContent:element.scrollWidth,rows:[...element.children].map(row=>{
      const label=row.querySelector('[data-layer-select]'),range=document.createRange(),rect=label.getBoundingClientRect(),parent=row.getBoundingClientRect();range.selectNodeContents(label);
      const actions=[...row.querySelectorAll('button[data-action],button[data-layer-move]')].map(button=>{
       const bounds=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);
       return {name:button.textContent.trim(),fits:[...range.getClientRects()].every(text=>text.left>=bounds.left-1&&text.right<=bounds.right+1&&text.top>=bounds.top-1&&text.bottom<=bounds.bottom+1)&&bounds.left>=parent.left-1&&bounds.right<=parent.right+1};
      });
      return {label:label.textContent,width:round(rect.width),rowWidth:round(parent.width),lines:range.getClientRects().length,selected:row.getAttribute('aria-current')==='true',actions};
     })};
    });
    metrics.push({language,...layout});
    if(process.env.OBSERVANDA_WEBSITE_LAYOUT_ARCHIVE==='1'){
     const cdp=await page.context().newCDPSession(page);
     try{const {data}=await cdp.send('Page.captureSnapshot',{format:'mhtml'});await info.attach(language+'-'+viewport.width+'x'+viewport.height,{body:Buffer.from(data),contentType:'multipart/related'});}
     finally{await cdp.detach();}
    }
    const context=language+' '+viewport.width+'px';
    expect.soft(layout.bodyWidth,context+' page width').toBeLessThanOrEqual(layout.viewport+1);
    expect.soft(layout.listContent,context+' list width').toBeLessThanOrEqual(layout.listWidth+1);
    expect(layout.rows.map(row=>row.label)).toEqual(labels);
    for(const row of layout.rows){
     expect.soft(row.width,context+' label '+row.label).toBeGreaterThanOrEqual(Math.min(150,row.rowWidth*.7));
     expect.soft(row.lines,context+' wrapped lines').toBeLessThanOrEqual(5);
     if(row.selected)expect(row.actions.map(action=>action.name)).toEqual(expect.arrayContaining([words.sectionEdit,words.up,words.down,words.duplicate,words.remove,words.layerMove]));
     else expect(row.actions).toHaveLength(0);
     expect.soft(row.actions.every(action=>action.fits),context+' action text and button bounds').toBe(true);
    }
   }
  }
  await info.attach('page-structure-geometry',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
  const first=rows.first(),down=first.getByRole('button',{name:catalan.down,exact:true});
  await first.locator('[data-layer-select]').press('Enter');
  await expect(first.getByRole('button',{name:catalan.up,exact:true})).toBeDisabled();
  await rows.last().locator('[data-layer-select]').press('Enter');
  await expect(rows.last().getByRole('button',{name:catalan.down,exact:true})).toBeDisabled();
  await first.locator('[data-layer-select]').press('Enter');
  await down.focus();await expect(down).toBeFocused();await page.keyboard.press('Enter');await expect(first).toContainText(labels[1]);
  await rows.nth(1).locator('[data-layer-select]').press('Enter');
  await rows.nth(1).getByRole('button',{name:catalan.up,exact:true}).press('Space');await expect(first).toContainText(labels[0]);
  await first.locator('[data-layer-select]').press('Enter');
  await first.getByRole('button',{name:catalan.remove,exact:true}).press('Enter');await expect(rows).toHaveCount(2);
  await page.getByRole('button',{name:catalan.undo,exact:true}).press('Enter');await expect(rows).toHaveCount(3);
  await expect(first).toContainText(labels[0]);
  const save=page.getByRole('button',{name:catalan.save,exact:true});if(await save.isEnabled())await save.press('Enter');
  await expect(page.locator('[data-website-files-status]')).toHaveText(catalan.saved);
  await page.reload();await expect(rows).toHaveCount(3);await expect(first).toContainText(labels[0]);
  completed=true;
 }finally{
  // On an assertion failure this disposable profile is about to be removed.
  // Its native leave prompt must not block teardown or obscure the failure.
  if(!completed&&page&&!page.isClosed())await page.evaluate(()=>window.addEventListener('beforeunload',event=>event.stopImmediatePropagation(),{capture:true,once:true})).catch(()=>{});
  await fixture.dispose(app);
 }
});
