import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {createFigure,createSeries} from '../../src/web/figure-model.js';
import {retainedFigureSVG} from '../../src/web/retained-figure-svg.js';
import {retainedFigureTable,retainedFigureCSV} from '../../src/web/retained-figure-data.js';
import {exactUnitScalar} from '../../src/web/measurement-unit-model.js';
const collect=async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk,'utf8'));return Buffer.concat(chunks).toString('utf8');};
async function figureReader(){
 const values=new Map(),documents=new RetainedFigureDocuments({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>values.set(key,value)}),f=createFigure();f.title='Retained acquisition with exact source coordinates and independent uncertainty';f.x.label='Counter offset from retained acquisition origin';f.y.label='Measured amplitude in the declared observation interval';f.style={legendPosition:'right',annotationLabels:'key',numberFormat:'radix',radix:6};
 f.projection={version:1,x:{origin:exactUnitScalar('1000000000000000000000000000000'),scale:exactUnitScalar('0.1','radix-fraction',6)}};
 f.series[0].name='Original acquisition with independently retained reference settings';f.series[0].points=[{x:1,y:2,error:.2},{x:2,y:3,error:null,xLower:1.8,xUpper:2.2,yLower:2.5,yUpper:3.5},{x:3,y:null,error:null},{x:4,y:5,error:.3}];const second=createSeries('Repeated acquisition with a separately documented measurement interval');second.points=[{x:1,y:1,error:.1},{x:2,y:2,error:.1},{x:4,y:4,error:.2}];f.series.push(second);
 f.annotations=[{id:randomUUID(),kind:'callout',seriesId:second.id,pointIndex:2,dx:24,dy:-36,label:'Retained final reading and its original measured uncertainty',color:'#92549f',opacity:.15}];return {reader:await documents.open(await documents.retain(f)),figure:f};
}
async function contained(page){
 const nodes=await page.locator('main svg text').evaluateAll(nodes=>nodes.filter(node=>!node.closest('clipPath')).map(node=>({text:[...node.querySelectorAll('tspan')].map(n=>n.textContent).join(''),box:node.getBoundingClientRect().toJSON(),frame:node.ownerSVGElement.getBoundingClientRect().toJSON()})));
 for(const {text,box,frame} of nodes){expect(box.left,text).toBeGreaterThanOrEqual(frame.left-2);expect(box.right,text).toBeLessThanOrEqual(frame.right+2);expect(box.top,text).toBeGreaterThanOrEqual(frame.top-2);expect(box.bottom,text).toBeLessThanOrEqual(frame.bottom+2);}
 const numericTicks=await page.locator('main svg text').evaluateAll(nodes=>nodes.filter(node=>/^(?:\u2248 )?(?:\d+#)?-?[\d.]+$/.test(node.querySelector('title')?.textContent??'')).map(node=>({label:node.querySelector('title').textContent,lines:node.querySelectorAll('tspan').length})));for(const tick of numericTicks)expect(tick.lines,tick.label+' must remain one numeric token').toBe(1);
 const labels=await page.locator('.figure-title,.figure-legend-label,.figure-axis-label,.figure-annotation-key-item text,.figure-projection-description').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,box:node.getBoundingClientRect().toJSON()})));
 for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].box,b=labels[j].box;expect(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1,labels[i].text+' / '+labels[j].text).toBe(false);}
}
test('complete retained figure SVG, table and CSV keep the same observations at desktop and phone widths',async({page},info)=>{
 const {reader,figure}=await figureReader();
 for(const width of [1000,390]){
  await page.setViewportSize({width,height:900});const svg=await collect(retainedFigureSVG(reader,{width:width-32}));expect(svg).not.toMatch(/NaN|Infinity|\[object Object\]|undefined/);
  await page.setContent('<style>body{margin:16px;font-family:system-ui}svg{display:block}</style><main>'+svg+'</main>');await expect(page.locator('.figure-observation')).toHaveCount(6);await expect(page.locator('.figure-measurement-interval').first()).toBeVisible();await contained(page);
  expect(await page.locator('.figure-title > title').textContent()).toBe(figure.title);await page.screenshot({path:info.outputPath(width===390?'retained-figure-phone.png':'retained-figure-desktop.png'),fullPage:true});
 }
 const table=await collect(retainedFigureTable(reader)),csv=await collect(retainedFigureCSV(reader));await page.setContent('<main>'+table+'</main>');await expect(page.locator('[data-point-id]')).toHaveCount(7);expect(csv.match(/"measurement",/g)?.length).toBe(7);await expect(page.locator('main')).toContainText('1000000000000000000000000000000');
});

test('generated date ticks preserve the entire timestamp within narrow intervals',async({page})=>{
 const values=new Map(),documents=new RetainedFigureDocuments({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>values.set(key,value)}),f=createFigure();f.x.kind='date';f.style={dateFormat:'datetime'};f.series[0].points=[{x:'2025-01-01T00:00:00.000Z',y:1,error:null},{x:'2025-01-03T00:00:00.000Z',y:2,error:null}];const reader=await documents.open(await documents.retain(f));await page.setViewportSize({width:390,height:900});await page.setContent('<style>body{margin:16px}</style><main>'+await collect(retainedFigureSVG(reader,{width:358}))+'</main>');
 const labels=await page.locator('.figure-generated-tick-label').evaluateAll(nodes=>nodes.filter(node=>node.querySelector('title').textContent.includes('T')).map(node=>({title:node.querySelector('title').textContent,visible:[...node.querySelectorAll('tspan')].map(n=>n.textContent),box:node.getBoundingClientRect().toJSON(),frame:node.ownerSVGElement.getBoundingClientRect().toJSON()})));expect(labels.length).toBeGreaterThanOrEqual(2);for(const label of labels){expect(label.visible).toEqual([label.title]);expect(label.title).toMatch(/^2025-01-\d{2}T\d{2}:\d{2}$/);expect(label.box.left).toBeGreaterThanOrEqual(label.frame.left);expect(label.box.right).toBeLessThanOrEqual(label.frame.right);}await contained(page);
});
