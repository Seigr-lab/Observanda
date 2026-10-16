import {renderFigure} from './figure-renderer.js';
import {figureStyle} from './figure-style.js';

// A single responsive mounting layer for both saved and proposed figures.
// Width is measured in CSS pixels, so text does not grow with a stretched SVG.
export function figurePreviews(){
 const mounted=new Map();
 const observer=new ResizeObserver(entries=>{
  for(const {target,contentRect} of entries){
   const item=mounted.get(target);
   if(item&&Math.abs(item.width-contentRect.width)>1)draw(target,item,contentRect.width);
  }
 });
 function draw(host,item,width){
  if(width<1)return;
  const style=figureStyle(item.figure);
  item.width=width;host.innerHTML=renderFigure(item.figure,{width:Math.max(280,Math.floor(width)),height:Math.max(260,Math.min(style.height,width*style.height/style.width)),idPrefix:item.prefix});
  host.classList.toggle('is-tall-preview',host.getBoundingClientRect().height>window.innerHeight-180);
 }
 function prune(){
  for(const host of mounted.keys())if(!host.isConnected){observer.unobserve(host);mounted.delete(host);}
 }
 function mount(host,figure,prefix='preview'){
  if(!host)return;
  prune();const item={figure,prefix,width:0};mounted.set(host,item);
  draw(host,item,host.getBoundingClientRect().width);observer.observe(host);
 }
 return {mount,prune,release(host){if(host){observer.unobserve(host);mounted.delete(host);}else{observer.disconnect();mounted.clear();}}};
}
