// Layout decisions are separate from annotation data and SVG rendering.
export {wrapFigureText as wrapAnnotationText} from './figure-text-layout.js';
import {measureFigureText as measure} from './figure-text-layout.js';
const overlaps=(a,b)=>a.x<b.x+b.width+4&&a.x+a.width+4>b.x&&a.y<b.y+b.height+4&&a.y+a.height+4>b.y;

export function placeAnnotationLabels(items,{left,top,plotW,plotH,size,mode}){
 if(mode==='hidden')return {key:false,labels:[]};
 if(mode==='key')return {key:items.length>0,labels:[]};
 const labels=[];
 for(const item of items){
  const width=measure(item.annotation.label,size),height=size*1.25;
  if(width>plotW-12)return {key:true,labels:[]};
  const position=Math.max(item.vertical?left:top,Math.min(item.vertical?left+plotW:top+plotH,item.start));
  const candidates=item.vertical?
   Array.from({length:4},(_,row)=>({x:Math.max(left+6,Math.min(left+plotW-width-6,position+4)),y:top+6+row*(height+6),width,height})):
   [-height-6,6].flatMap(offset=>[left+6,left+plotW-width-6].map(x=>({x,y:position+offset,width,height})));
  const box=candidates.find(box=>box.y>=top+4&&box.y+height<=top+plotH-4&&!labels.some(label=>overlaps(label.box,box)));
  if(!box)return {key:true,labels:[]};
  labels.push({item,box});
 }
 return {key:false,labels};
}
