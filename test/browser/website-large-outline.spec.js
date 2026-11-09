import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

function inspectionPage(){
 const stations=Array.from({length:600},(_,i)=>'<section id="station-'+i+'"><h2>Station '+i+'</h2><article><h3>Emission measurements</h3>'+Array.from({length:4},(_,j)=>'<p id="assay-'+i+'-'+j+'">Assay '+i+'.'+j+': <span>H<sub>2</sub>O</span> and <span>Fe<sup>3+</sup></span></p>').join('')+'</article></section>').join('');
 return '<!doctype html><html lang="en"><head><title>Station register</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Station register</h1><section><p id="probe">Calibration.</p></section>'+stations+'</main></body></html>';
}
function distribution(values){
 const sorted=[...values].sort((a,b)=>a-b),at=p=>Math.round(sorted[Math.ceil(p*sorted.length)-1]);
 return {samples:values.length,p50:at(.5),p95:at(.95),max:at(1)};
}
test('editing and navigating a large nested saved page keeps the outline bounded',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-large-outline-')),previous=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  await store.importFiles(id,{name:'Station register',files:new Map([['index.html',inspectionPage()],['style.css','body{font:16px/1.5 system-ui}p{margin:3px 0}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  const started=performance.now();await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const frame=page.frameLocator('#website-files-canvas'),body=frame.locator('body'),probe=frame.locator('#probe'),list=page.locator('[data-website-files-structure]'),rows=list.locator('li'),search=page.getByRole('searchbox',{name:'Filter page layers'});
  await expect(probe).toBeVisible();await expect(rows).toHaveCount(48);const openMs=Math.round(performance.now()-started);
  const metrics=await body.evaluate(body=>{
   const doc=body.ownerDocument,stats={walkers:0,clones:0},win=doc.defaultView;
   const walk=win.Document.prototype.createTreeWalker,clone=win.Document.prototype.cloneNode;
   win.Document.prototype.createTreeWalker=function(...args){stats.walkers++;return walk.apply(this,args);};
   win.Document.prototype.cloneNode=function(...args){stats.clones++;return clone.apply(this,args);};win.outlineStats=stats;
   const stack=[[body,1]];let elements=0,nodes=0,depth=0;
   while(stack.length){const [n,level]=stack.pop();if(n.nodeType===1&&n.hasAttribute('data-observanda-editor'))continue;nodes++;
    if(n.nodeType===1){elements++;depth=Math.max(depth,level);}for(const c of n.childNodes)stack.push([c,level+1]);}
   return {elements,nodes,depth};
  });
  expect(metrics.elements).toBeGreaterThan(10000);
  const filterMs=[],selectMs=[],typingMs=[];
  for(const i of [1,30,250,590,8,80,350,599,4,75,401,507]){
   const start=performance.now();await search.fill('assay-'+i+'-2');
   const sel=list.locator('[data-layer-select]');await expect(sel).toHaveCount(1);await expect(sel).toContainText('Assay '+i+'.2');filterMs.push(performance.now()-start);
   const pick=performance.now();await sel.click();await expect(page.locator('[data-layer-trail] [aria-current]')).toContainText('Assay '+i+'.2');selectMs.push(performance.now()-pick);
  }
  await search.fill('probe');await expect(rows).toHaveCount(1);await list.locator('[data-layer-select]').click();
  await probe.click();await page.keyboard.press('End');const before=await body.evaluate(n=>({...n.ownerDocument.defaultView.outlineStats}));
  let expected='Calibration.';
  for(const ch of 'abcdefghij'){
   const start=performance.now();await page.keyboard.press(ch);expected+=ch;
   await page.waitForFunction(value=>Array.from(document.querySelectorAll('[data-layer-select]')).some(row=>row.textContent===value),expected,{polling:'raf'});
   typingMs.push(performance.now()-start);
  }
  const after=await body.evaluate(n=>({...n.ownerDocument.defaultView.outlineStats}));
  // Ordinary typing updates its label and enclosing headings, independent of
  // the other stations. Inserting a paragraph *does* change descendant paths.
  expect(after.walkers-before.walkers).toBeLessThanOrEqual(2*metrics.depth*typingMs.length);
  await page.keyboard.press('Enter');await page.keyboard.type('Recalibrated after the final run.');
  await search.fill('Recalibrated after the final run.');await expect(list.locator('[data-layer-select]')).toHaveCount(1);
  await list.locator('[data-layer-select]').click();await expect(page.locator('[data-layer-trail] [aria-current]')).toHaveText('Recalibrated after the final run.');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const saved=(await store.open(id)).html;expect(saved).toContain(expected);expect(saved).toContain('Recalibrated after the final run.');
  console.info(JSON.stringify({...metrics,openMs,mountedRows:48,filterMs:distribution(filterMs),selectMs:distribution(selectMs),typingThroughOutlineMs:distribution(typingMs),typingWalkers:after.walkers-before.walkers,typingDocumentClones:after.clones-before.clones}));
 }finally{
  if(previous===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=previous;
  try{await page.close();await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});
