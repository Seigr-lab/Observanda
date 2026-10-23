import {createComposition} from '../../src/web/figure-composition.js';
import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {createFigure,createSeries} from '../../src/web/figure-model.js';
import {defaultHeatmap} from '../../src/web/figure-heatmap.js';
import {retainedFigureSVG} from '../../src/web/retained-figure-svg.js';
const webRoot=fileURLToPath(new URL('../../src/web/',import.meta.url));
for(const kind of ['bar','heatmap'])test(kind+' retained figure reader pages exact observations, full text and downloads without clearing a failed view',async({page})=>{
 const files=new Map(),documents=new RetainedFigureDocuments({readMetadata:async name=>files.get(name)??null,writeMetadata:async(name,value)=>files.set(name,value)}),figure=createFigure(),calls=[],revision='a'.repeat(64);figure.kind=kind;if(kind==='heatmap')figure.heatmap=defaultHeatmap();figure.x.kind='category';figure.series[0].name='First acquired series';const category='A'.repeat(4095)+'\ud83d\ude00'+' complete category';figure.series[0].points=Array.from({length:65},(_,i)=>({x:i===0?category:'Category '+i,y:i+1,error:null}));figure.series.push({...createSeries('Second acquired series'),points:[{x:'Independent',y:7,error:null}]});const reader=await documents.open(await documents.retain(figure));let stale=false;
 await page.exposeFunction('retainedRequest',async command=>{
  calls.push(command);if(command.expectedRevision)expect(command.expectedRevision).toBe(revision);let result;
  if(command.operation==='header')result=await reader.header(command.selection);
  else if(command.operation==='window')result=await reader.window(command.selection);
  else if(command.operation==='cells')result=await reader.cells(command.selection);
  else if(command.operation==='item')result={item:await reader.item(command.selection)};
  else if(command.operation==='text')result=await reader.text(command.selection);
  else if(command.operation==='svg'){let svg='';for await(const chunk of retainedFigureSVG(reader,{width:650,window:command.window}))svg+=chunk;result={svg};}
  else throw Error('Unexpected reader operation');return {...result,revision:stale?'b'.repeat(64):revision};
 });
 let downloadedRevision=null;
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/'){response.setHeader('Content-Type','text/html');response.end('<main id="figure"></main><script type="module">import {retainedFigureReader} from "/retained-figure-reader.js";window.reader=retainedFigureReader({root:document.getElementById("figure"),request:command=>window.retainedRequest(command),inspectResults:'+(kind==='bar'?'(id,revision)=>window.resultSelection={id,revision}':'null')+',downloadURL:(format,revision)=>"/download?format="+format+"&revision="+revision});window.ready=window.reader.ready;</script>');return;}
  if(url.pathname==='/download'){downloadedRevision=url.searchParams.get('revision');response.setHeader('Content-Type','application/json');response.setHeader('Content-Disposition','attachment; filename="figure.json"');for await(const chunk of reader.json())response.write(chunk);response.end();return;}
  const location=path.resolve(webRoot,'.'+decodeURIComponent(url.pathname));if(!location.startsWith(webRoot)){response.writeHead(404).end();return;}response.setHeader('Content-Type',location.endsWith('.json')?'application/json':'text/javascript');response.end(await readFile(location));
 })().catch(()=>response.writeHead(500).end());});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>window.ready);await expect(page.locator('[data-rf-range]')).toHaveText('1-32 of '+(kind==='heatmap'?66:65));await expect(page.locator('tbody tr')).toHaveCount(32);if(kind==='bar'){await page.locator('[data-rf="results"]').click();expect(await page.evaluate(()=>resultSelection)).toEqual({id:figure.id,revision});}else await expect(page.locator('[data-rf="results"]')).toHaveCount(0);
 await page.locator('[data-rf="observations-next"]').click();await expect(page.locator('[data-rf-range]')).toHaveText('33-64 of '+(kind==='heatmap'?66:65));await page.locator('[data-rf="observations-next"]').click();await expect(page.locator('[data-rf-range]')).toHaveText(kind==='heatmap'?'65-66 of 66':'65-65 of 65');await expect(page.locator('[data-rf="observations-next"]')).toBeDisabled();await expect(page.locator('tbody tr')).toHaveCount(kind==='heatmap'?2:1);
 await page.locator('[data-rf-position="observations"]').fill('1');await page.locator('[data-rf="observations"]').click();await expect(page.locator('[data-rf-range]')).toHaveText('1-32 of '+(kind==='heatmap'?66:65));await page.locator('[data-rf="point-0"]').click();await expect(page.locator('[data-rf-details]')).toContainText('Observation details 1');await page.locator('[data-rf="point-text-0"]').click();await expect(page.locator('[data-rf-details] pre')).toHaveText('A'.repeat(4095)+'\ud83d\ude00');await page.locator('[data-rf="text-next"]').click();await expect(page.locator('[data-rf-details] pre')).toHaveText(' complete category');await page.locator('[data-rf="text-previous"]').click();await expect(page.locator('[data-rf-details] pre')).toHaveText('A'.repeat(4095)+'\ud83d\ude00');
 stale=true;await page.locator('[data-rf="series-next"]').click();await expect(page.locator('[data-rf-status]')).toContainText('The figure changed');await expect(page.locator('[data-rf-range]')).toHaveText('1-32 of '+(kind==='heatmap'?66:65));stale=false;await page.locator('[data-rf="series-next"]').click();await expect(page.locator('[data-rf-range]')).toHaveText(kind==='heatmap'?'1-32 of 66':'1-1 of 1');if(kind==='heatmap')await expect(page.locator('tbody tr').first()).toContainText('No retained value');await expect(page.locator('main')).toContainText('Second acquired series');
 const downloaded=page.waitForEvent('download');await page.getByRole('link',{name:'Source JSON',exact:true}).click();const download=await downloaded,body=JSON.parse(await readFile(await download.path(),'utf8'));expect(body.series[0].points[0].x).toBe(category);expect(body.series[0].points).toHaveLength(65);expect(calls.filter(c=>c.operation==='window').every(c=>c.selection.limit<=32)).toBe(true);expect(calls.filter(c=>c.operation==='svg').every(c=>c.window.seriesLimit===1&&c.window.pointLimit===32)).toBe(true);expect(downloadedRevision).toBe(revision);expect(errors).toEqual([]);await page.evaluate(()=>window.reader.dispose());
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});


test('dense chronological and many-series interval reading stays paged on narrow screens with enlarged text',async({page},info)=>{
 const files=new Map(),documents=new RetainedFigureDocuments({readMetadata:async name=>files.get(name)??null,writeMetadata:async(name,value)=>files.set(name,value)}),trace=createFigure(),grouped=createFigure(),calls=[],revision='c'.repeat(64),stamp=i=>new Date(Date.UTC(2026,0,1)+i*1000).toISOString();
 trace.title='Chronological observations';trace.x.kind='date';trace.x.label='Acquisition timestamp';trace.y.label='Measured value';trace.series[0].points=Array.from({length:1025},(_,i)=>({x:stamp(i),y:i,error:null}));
 grouped.title='Independent interval series';grouped.x.kind='date';grouped.series=Array.from({length:257},(_,i)=>({...createSeries('Acquisition series '+(i+1),i),points:Array.from({length:4},(_,j)=>({x:stamp(i+j*257),y:i+j,error:null,yLower:i+j-0.25,yUpper:i+j+0.5}))}));
 const reader=await documents.open(await documents.retain(createComposition([trace,grouped])));
 await page.exposeFunction('retainedRequest',async command=>{
  calls.push(command);if(command.expectedRevision)expect(command.expectedRevision).toBe(revision);let result;
  if(command.operation==='header')result=await reader.header(command.selection);
  else if(command.operation==='window')result=await reader.window(command.selection);
  else if(command.operation==='item')result={item:await reader.item(command.selection)};
  else if(command.operation==='svg'){let svg='';for await(const chunk of retainedFigureSVG(reader,{width:650,window:command.window}))svg+=chunk;result={svg};}
  else throw Error('Unexpected dense reader operation');return {...result,revision};
 });
 const server=createServer((request,response)=>{void(async()=>{
  const url=new URL(request.url,'http://127.0.0.1');if(url.pathname==='/'){response.setHeader('Content-Type','text/html');response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/research-materials.css"><dialog><div class="material-workbench"><h2>Read figure</h2><form><div id="figure" class="material-figure"></div></form></div></dialog><script type="module">document.querySelector("dialog").showModal();import {retainedFigureReader} from "/retained-figure-reader.js";window.reader=retainedFigureReader({root:document.getElementById("figure"),request:command=>window.retainedRequest(command)});window.ready=window.reader.ready;</script>');return;}
  const location=path.resolve(webRoot,'.'+decodeURIComponent(url.pathname));const relative=path.relative(webRoot,location);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){response.writeHead(404).end();return;}response.setHeader('Content-Type',location.endsWith('.json')?'application/json':location.endsWith('.css')?'text/css':'text/javascript');response.end(await readFile(location));
 })().catch(()=>response.writeHead(500).end());});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>window.ready);await expect(page.locator('[data-rf-range]')).toHaveText('1-32 of 1025');
  await page.locator('[data-rf-position="observations"]').fill('1025');await page.locator('[data-rf="observations"]').click();await expect(page.locator('[data-rf-range]')).toHaveText('1025-1025 of 1025');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText(stamp(1024));await page.locator('[data-rf="point-0"]').click();await expect(page.locator('[data-rf-details]')).toContainText('1024');await page.locator('[data-rf="details-close"]').click();
  await page.locator('[data-rf="panel-next"]').click();await expect(page.locator('[data-rf-position="series"]')).toHaveAttribute('max','257');await page.locator('[data-rf-position="series"]').fill('257');await page.locator('[data-rf="series"]').click();await expect(page.locator('#figure')).toContainText('Acquisition series 257');await expect(page.locator('[data-rf-range]')).toHaveText('1-4 of 4');await expect(page.locator('svg .figure-measurement-interval')).toHaveCount(4);
  await page.locator('[data-rf="point-3"]').click();await expect(page.locator('[data-rf-details] pre')).toContainText('258.75');await expect(page.locator('[data-rf-details] pre')).toContainText('259.5');const stable=await page.locator('[data-rf-details]').getAttribute('data-point-id');await page.locator('[data-rf="details-close"]').click();
  for(const percent of [100,200]){
   await page.setViewportSize({width:390,height:844});await page.evaluate(value=>document.documentElement.style.fontSize=value+'%',percent);await page.locator('[data-rf-position="series"]').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
   const table=page.locator('.material-table');await table.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>table.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);await page.locator('[data-rf="point-3"]').click();await expect(page.locator('[data-rf-details]')).toHaveAttribute('data-point-id',stable);await expect(page.locator('[data-rf-details] pre')).toContainText(stamp(1027));await page.screenshot({path:info.outputPath('dense-reader-'+percent+'.png')});await page.locator('[data-rf="details-close"]').click();
  }
  expect(calls.filter(c=>c.operation==='window').every(c=>c.selection.limit<=32)).toBe(true);expect(calls.filter(c=>c.operation==='svg').every(c=>c.window.seriesLimit===1&&c.window.pointLimit===32)).toBe(true);expect(errors).toEqual([]);await page.evaluate(()=>window.reader.dispose());
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
