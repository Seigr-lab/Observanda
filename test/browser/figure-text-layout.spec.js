import {test,expect} from '@playwright/test';
import {createFigure,createSeries} from '../../src/web/figure-model.js';
import {createComposition} from '../../src/web/figure-composition.js';
import {renderFigure} from '../../src/web/figure-renderer.js';

function figure(position){
 const f=createFigure();f.title='Comparison of retained acquisition conditions with independent decoder revisions and explicit exclusion criteria';
 f.style={legendPosition:position,titleSize:24,legendSize:18};
 f.series=Array.from({length:4},(_,i)=>({...createSeries('Returned capture decoded with calibration revision '+(i+1)+' and independently assessed boundary conditions',i),points:[{x:0,y:i+1,error:.1},{x:1,y:i+2,error:.2}]}));
 return f;
}
async function verify(page,expected,{splitWords=false}={}){
 const texts=await page.locator('.figure-title,.figure-legend-label,.figure-composition-title').evaluateAll(nodes=>nodes.map(node=>({
  text:[...node.querySelectorAll('tspan')].map(n=>n.textContent).join(' '),box:node.getBoundingClientRect().toJSON(),frame:node.ownerSVGElement.getBoundingClientRect().toJSON()
 })));
 const normalize=text=>splitWords?text.replaceAll(' ',''):text;
 expect(texts.map(t=>normalize(t.text))).toEqual(expected.map(normalize));
 for(const {text,box,frame} of texts){
  expect(text).not.toContain('…');expect(box.left).toBeGreaterThanOrEqual(frame.left-1);expect(box.right).toBeLessThanOrEqual(frame.right+1);
  expect(box.top).toBeGreaterThanOrEqual(frame.top-1);expect(box.bottom).toBeLessThanOrEqual(frame.bottom+1);
 }
 for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
  const a=texts[i].box,b=texts[j].box;
  expect(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1,texts[i].text+' / '+texts[j].text).toBe(false);
 }
 const clips=await page.locator('clipPath rect').evaluateAll(nodes=>nodes.map(node=>{const svg=node.ownerSVGElement,pt=svg.createSVGPoint();pt.x=Number(node.getAttribute('x'));pt.y=Number(node.getAttribute('y'));const p=pt.matrixTransform(node.getScreenCTM());return {left:p.x,top:p.y,width:Number(node.getAttribute('width'))*node.getScreenCTM().a,height:Number(node.getAttribute('height'))*node.getScreenCTM().d};}));
 for(const t of texts)for(const clip of clips)expect(t.box.left<clip.left+clip.width-1&&t.box.right>clip.left+1&&t.box.top<clip.top+clip.height-1&&t.box.bottom>clip.top+1,t.text+' overlaps plot').toBe(false);
}

test('full scientific titles and distinct legend names fit in single and multi-panel SVG exports',async({page},info)=>{
 for(const width of [320,650,840])for(const position of ['top','bottom','right']){
  const f=figure(position);await page.setViewportSize({width:width+40,height:1000});await page.setContent(renderFigure(f,{width}));
  await verify(page,[f.title,...f.series.map(s=>s.name)]);
  if(width===840&&position==='right')await page.locator('svg').screenshot({path:info.outputPath('full-figure-labels.png')});
 }
 const f=figure('top'),composition=createComposition([f,f]);composition.title=f.title;composition.layout.columns=2;
 await page.setViewportSize({width:1040,height:1000});await page.setContent(renderFigure(composition,{width:1000}));
 await verify(page,[composition.title,...composition.panels.flatMap(p=>[p.figure.title,...p.figure.series.map(s=>s.name)])]);
});

test('long identifiers and wide glyphs remain complete within the figure in every supported font',async({page})=>{
 for(const font of ['sans','serif','mono']){
  const f=figure('top');f.title='🧪'.repeat(24);f.style.font=font;f.series=f.series.slice(0,1);f.series[0].name='W'.repeat(90);
  await page.setContent(renderFigure(f,{width:320}));await verify(page,[f.title,f.series[0].name],{splitWords:true});
 }
});
