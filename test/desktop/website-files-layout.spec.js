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

test('page structure retains readable labels and keyboard actions in desktop windows',async({},info)=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_EXECUTABLE&&process.env.OBSERVANDA_QUALIFY_SOURCE_WEBSITE!=='1','Requires an isolated desktop qualification.');
 test.setTimeout(180000);
 const fixture=await websiteDesktopFixture(),metrics=[];
 let app;
 try{
  app=await fixture.start(undefined,{expectedVersion:process.env.OBSERVANDA_WEBSITE_LAYOUT_VERSION});const page=await app.firstWindow();
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
 }finally{await fixture.dispose(app);}
});
