import {test,expect} from '@playwright/test';
import {createFigure} from '../../src/web/figure-model.js';
import {createAnnotation} from '../../src/web/figure-annotations.js';
import {createComposition} from '../../src/web/figure-composition.js';
import {renderFigure} from '../../src/web/figure-renderer.js';

function plot(count=12){
 const f=createFigure();f.title='Acquisition phases';f.x.label='Time (s)';f.y.label='Signal (V)';
 f.series[0].points=[{x:0,y:1,error:.1},{x:1,y:2,error:.2}];
 f.annotations=Array.from({length:count},(_,i)=>({...createAnnotation(i%2?'interval':'boundary'),start:.2+i*.001,end:i%2?.2+i*.001+.0001:null,label:'Acquisition phase '+(i+1)+' with its complete explanation'}));return f;
}
async function check(root){
 const boxes=await root.locator('.figure-annotation-key-label,.figure-annotation-key-position,.figure-annotation-label').evaluateAll(nodes=>nodes.map(node=>({bounds:node.getBoundingClientRect().toJSON(),frame:node.ownerSVGElement.getBoundingClientRect().toJSON(),text:node.textContent,font:Number.parseFloat(getComputedStyle(node).fontSize)})));
 expect(boxes.length).toBeGreaterThan(0);
 for(const {bounds,frame,text,font} of boxes){
  expect(text).not.toContain('…');expect(font).toBeGreaterThanOrEqual(12);
  expect(bounds.left).toBeGreaterThanOrEqual(frame.left-1);expect(bounds.right).toBeLessThanOrEqual(frame.right+1);
  expect(bounds.top).toBeGreaterThanOrEqual(frame.top-1);expect(bounds.bottom).toBeLessThanOrEqual(frame.bottom+1);
 }
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i].bounds,b=boxes[j].bounds;expect(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1,boxes[i].text+' / '+boxes[j].text).toBe(false);
 }
}

test('dense and multi-panel annotation keys stay legible, complete and separate at narrow and wide widths',async({page},info)=>{
 for(const width of [320,960]){
  await page.setViewportSize({width:width+40,height:900});
  const f=plot();await page.setContent(renderFigure(f,{width}));const svg=page.locator('svg');
  await expect(svg.locator('.figure-annotation-key-item')).toHaveCount(12);await check(svg);
  const labels=await svg.locator('.figure-annotation-key-label').evaluateAll(nodes=>nodes.map(node=>[...node.children].map(c=>c.textContent).join(' ')));
  expect(labels).toEqual(f.annotations.map(a=>a.label));await svg.screenshot({path:info.outputPath('annotation-key-'+width+'.png')});
 }
 const composition=createComposition(Array.from({length:8},()=>plot()));composition.layout.columns=3;composition.layout.linkX=true;composition.layout.linkY=true;
 await page.setViewportSize({width:1240,height:900});await page.setContent(renderFigure(composition,{width:1200}));
 await expect(page.locator('.figure-annotation-key-item')).toHaveCount(96);await check(page.locator('body'));
 await page.locator('svg').first().screenshot({path:info.outputPath('eight-panel-annotations.png')});
 const short=plot(3);short.annotations.forEach((a,i)=>a.label='Phase '+i);await page.setContent(renderFigure(short,{width:960}));
 await expect(page.locator('.figure-annotation-label')).toHaveCount(3);await check(page.locator('body'));
});
