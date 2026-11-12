import {pdfCompositionKey} from './pdf-composition-model.js';

// Coordinates are millimetres within the printable area. Reordering the
// temporary working set never changes the document's logical reading order.
export function compositionSelection(boxes,keys){
 return boxes.filter(box=>keys.has(pdfCompositionKey(box.target)));
}
function extent(boxes,axis,size){
 let first=Infinity,last=-Infinity,total=0;
 for(const box of boxes){first=Math.min(first,box[axis]);last=Math.max(last,box[axis]+box[size]);total+=box[size];}
 return {first,last,total};
}
function replace(boxes,edits){
 return boxes.map(box=>edits.get(box)??box);
}
export function compositionMovement(boxes,keys,anchor,area,grid=0){
 if(!Number.isFinite(grid)||grid<0||!keys.has(pdfCompositionKey(anchor.target)))return null;
 const selected=compositionSelection(boxes,keys),horizontal=extent(selected,'xMm','widthMm'),vertical=extent(selected,'yMm','heightMm');
 if(!selected.length||horizontal.last-horizontal.first>area.widthMm||vertical.last-vertical.first>area.heightMm)return null;
 const distance=(value,delta,start,end,limit)=>{
  const snapped=grid?Math.round((value+delta)/grid)*grid-value:delta;
  return Math.max(-start,Math.min(snapped,limit-end));
 };
 return (dx,dy)=>{
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return null;
  dx=distance(anchor.xMm,dx,horizontal.first,horizontal.last,area.widthMm);dy=distance(anchor.yMm,dy,vertical.first,vertical.last,area.heightMm);
  return new Map(selected.map(box=>[box,{...box,xMm:box.xMm+dx,yMm:box.yMm+dy}]));
 };
}
export function arrangeComposition(boxes,keys,area,{axis,placement,relative='selection'}){
 if(!['horizontal','vertical'].includes(axis)||!['start','middle','end','distribute'].includes(placement)||!['selection','page'].includes(relative))return null;
 const selected=compositionSelection(boxes,keys),spread=placement==='distribute';
 if(selected.length<(spread?3:relative==='page'?1:2))return null;
 const [position,size]=axis==='horizontal'?['xMm','widthMm']:['yMm','heightMm'];
 const range=extent(selected,position,size),first=relative==='page'?0:range.first,last=relative==='page'?area[size]:range.last;
 const edits=new Map();
 if(spread){
  const gap=(last-first-range.total)/(selected.length-1);if(gap<0)return null;
  const ordered=selected.sort((a,b)=>a[position]-b[position]);let coordinate=first;
  for(const box of ordered){edits.set(box,{...box,[position]:coordinate});coordinate+=box[size]+gap;}
 }else for(const box of selected){
  const value=placement==='start'?first:placement==='end'?last-box[size]:(first+last-box[size])/2;
  if(value<0||value+box[size]>area[size]+1e-7)return null;
  edits.set(box,{...box,[position]:value});
 }
 return replace(boxes,edits);
}
