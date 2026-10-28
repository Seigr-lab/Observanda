import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('local canvas moves retain nested nodes and event handlers without rebuilding content',async({page})=>{
 const modules=new Map(await Promise.all(['website-canvas-order.js','composition-tree.js'].map(async name=>['/'+name,await readFile(new URL('../../src/web/'+name,import.meta.url),'utf8')])));
 await page.route('http://canvas.test/**',route=>{
  const source=modules.get(new URL(route.request().url()).pathname);
  return route.fulfill({contentType:source?'text/javascript':'text/html',body:source??'<main></main>'});
 });
 await page.goto('http://canvas.test/');
 const result=await page.evaluate(async()=>{
  const {updateCanvasOrder}=await import('/website-canvas-order.js'),root=document.querySelector('main');
  root.innerHTML='<section data-section-id="outer"><div class="container-content"><section data-section-id="inner"><details open><summary>Nested</summary><div class="container-content"><section data-section-id="text"><input value="Retained"></section><button data-drop-parent="inner">Add</button></div></details></section><button data-drop-parent="outer">Add</button></div></section><section data-section-id="other">Other</section><button data-drop-parent="">Add</button>';
  const nodes=new Map([...root.querySelectorAll('[data-section-id]')].map(n=>[n.dataset.sectionId,n]));let clicks=0;
  nodes.get('text').addEventListener('click',()=>clicks++);
  const sections=[{id:'other',kind:'text'},{id:'inner',kind:'disclosure'},{id:'outer',kind:'container',parentId:'inner'},{id:'text',kind:'text',parentId:'outer'}];
  const moved=updateCanvasOrder(root,sections),stable=!updateCanvasOrder(root,sections);
  nodes.get('text').click();
  return {moved,stable,clicks,identity:[...nodes].every(([id,node])=>root.querySelector('[data-section-id="'+id+'"]')===node),order:[...root.querySelectorAll('[data-section-id]')].map(n=>n.dataset.sectionId),value:root.querySelector('input').value,open:root.querySelector('details').open,parent:nodes.get('text').parentElement.parentElement.dataset.sectionId,zones:root.querySelectorAll('[data-drop-parent]').length};
 });
 expect(result).toEqual({moved:true,stable:true,clicks:1,identity:true,order:['other','inner','outer','text'],value:'Retained',open:true,parent:'outer',zones:3});
});
