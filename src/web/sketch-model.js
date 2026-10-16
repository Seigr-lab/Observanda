import {researchId} from './research-reference.js';
export const SKETCH_KINDS=['stroke','line','arrow','rectangle','ellipse','text'];
export const SKETCH_LIMITS={items:200,strokePoints:2048,points:20000,bytes:512*1024};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const colour=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const number=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
export function validSketch(a){
 if(!exact(a,['version','id','title','description','width','height','background','items'])||a.version!==1||!researchId(a.id)||!text(a.title,300,true)||!text(a.description,20000,true)||!Number.isInteger(a.width)||!number(a.width,160,4096)||!Number.isInteger(a.height)||!number(a.height,160,4096)||!colour(a.background)||!Array.isArray(a.items)||a.items.length>SKETCH_LIMITS.items)return false;
 const ids=new Set();let points=0;
 for(const i of a.items){
  if(!i||!researchId(i.id)||ids.has(i.id)||!SKETCH_KINDS.includes(i.kind)||!colour(i.colour))return false;ids.add(i.id);
  const xy=p=>Array.isArray(p)&&p.length===2&&number(p[0],0,a.width)&&number(p[1],0,a.height);
  if(i.kind==='stroke'){
   if(!exact(i,['id','kind','colour','weight','points'])||!number(i.weight,.5,24)||!Array.isArray(i.points)||!i.points.length||i.points.length>SKETCH_LIMITS.strokePoints||!i.points.every(xy))return false;points+=i.points.length;
  }else if(i.kind==='text'){
   if(!exact(i,['id','kind','colour','x','y','text','size'])||!xy([i.x,i.y])||!text(i.text,1000,true)||!number(i.size,8,96))return false;
  }else if(!exact(i,['id','kind','colour','weight','fill','x','y','x2','y2'])||!number(i.weight,.5,24)||!(i.fill==='none'||colour(i.fill))||!xy([i.x,i.y])||!xy([i.x2,i.y2]))return false;
 }
 return points<=SKETCH_LIMITS.points&&new TextEncoder().encode(JSON.stringify(a)).length<=SKETCH_LIMITS.bytes;
}
export const sketchTextContent=a=>[a.title,a.description,...a.items.filter(i=>i.kind==='text').map(i=>i.text)].join('\n');
export const newSketch=id=>({version:1,id,title:'',description:'',width:900,height:540,background:'#ffffff',items:[]});
export function sketchBounds(i){const points=i.kind==='stroke'?i.points:i.kind==='text'?[[i.x,i.y]]:[[i.x,i.y],[i.x2,i.y2]];return {left:Math.min(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),right:Math.max(...points.map(p=>p[0])),bottom:Math.max(...points.map(p=>p[1]))};}
export function moveSketchItem(i,dx,dy,a){
 const b=sketchBounds(i);dx=Math.max(-b.left,Math.min(a.width-b.right,dx));dy=Math.max(-b.top,Math.min(a.height-b.bottom,dy));
 const n=structuredClone(i);if(n.kind==='stroke')n.points=n.points.map(([x,y])=>[x+dx,y+dy]);else{n.x+=dx;n.y+=dy;if(n.kind!=='text'){n.x2+=dx;n.y2+=dy;}}return n;
}
