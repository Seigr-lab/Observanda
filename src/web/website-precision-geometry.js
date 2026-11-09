import {managedWebsiteContent} from './website-authored-nodes.js';

const editable='main,figure,section,article,aside,div,p,img,figcaption,h1,h2,h3,h4,h5,h6';
const local=n=>n.ownerDocument.defaultView.getComputedStyle(n);
const px=value=>Math.round(value*100)/100+'px';
export const precisionEligible=node=>!!node?.matches(editable)&&!node.closest(managedWebsiteContent+',template,[hidden]');
export const precisionChildren=parent=>Array.from(parent?.children??[]).filter(n=>precisionEligible(n)&&n.getClientRects().length);

function ordinaryPlane(node,knownParent){
 for(let ancestor=node;ancestor&&ancestor!==knownParent;ancestor=ancestor.parentElement){
  const s=local(ancestor);
  if(s.transform!=='none'||s.perspective!=='none'||['scale','rotate','translate'].some(p=>s[p]&&s[p]!=='none')||
     s.writingMode!=='horizontal-tb'||s.zoom&&s.zoom!=='1'&&s.zoom!=='normal')return false;
 }
 return true;
}
export function precisionPlane(node,knownParent){
 if(!precisionEligible(node)||!node.isConnected||!node.parentElement)return {reason:'precisionProtected'};
 if(!ordinaryPlane(node,knownParent))return {reason:'precisionTransform'};
 const parent=node.parentElement,rect=node.getBoundingClientRect(),box=parent.getBoundingClientRect(),style=local(node);
 if(!rect.width||!rect.height||!parent.clientWidth||!parent.clientHeight)return {reason:'precisionNoSpace'};
 const width=parent.clientWidth,height=parent.clientHeight,x=rect.left-box.left-parent.clientLeft+parent.scrollLeft,y=rect.top-box.top-parent.clientTop+parent.scrollTop;
 const absolute=style.position==='absolute'&&node.offsetParent===parent;
 return {node,parent,style,rect,width,height,x,y,absolute,containing:['absolute','fixed'].includes(style.position)?node.offsetParent:parent};
}
export function precisionStackingOwner(node){
 for(let p=node.parentElement;p&&p!==node.ownerDocument.documentElement;p=p.parentElement){
  const s=local(p);
  if(s.isolation==='isolate'||parseFloat(s.opacity)<1||['sticky','fixed'].includes(s.position)||s.zIndex!=='auto'&&(s.position!=='static'||local(p.parentElement).display.match(/grid|flex/))||
    ['transform','filter','backdropFilter','perspective','clipPath','maskImage','scale','translate','rotate'].some(key=>s[key]&&s[key]!=='none')||
    /(?:layout|paint|strict|content)/.test(s.contain)||/(?:opacity|transform|filter|perspective|clip-path)/.test(s.willChange)||s.mixBlendMode!=='normal')return p;
 }
 return null;
}
const bounded=(value,low,high)=>Math.max(low,Math.min(high,value));
export function precisionNeighbours(plane){
 const x=[0,(plane.width-plane.rect.width)/2,plane.width-plane.rect.width],y=[0,(plane.height-plane.rect.height)/2,plane.height-plane.rect.height],boxes=[];
 for(const other of plane.parent.children){
  if(other===plane.node||!precisionEligible(other)||!other.getClientRects().length)continue;
  const r=other.getBoundingClientRect(),left=plane.x+r.left-plane.rect.left,top=plane.y+r.top-plane.rect.top;
  x.push(left,left+(r.width-plane.rect.width)/2,left+r.width-plane.rect.width,left+r.width,left-plane.rect.width);
  y.push(top,top+(r.height-plane.rect.height)/2,top+r.height-plane.rect.height,top+r.height,top-plane.rect.height);
  if(local(other).position==='absolute')boxes.push({node:other,left,top,width:r.width,height:r.height});
 }
 return {x:x.sort((a,b)=>a-b),y:y.sort((a,b)=>a-b),boxes};
}
function snap(value,anchors,step,enabled){
 if(!enabled)return {value};
 let low=0,high=anchors.length;
 while(low<high){const mid=Math.floor((low+high)/2);if(anchors[mid]<value)low=mid+1;else high=mid;}
 const grid=Math.round(value/step)*step,candidates=[anchors[low-1],anchors[low],grid];
 let closest=value,distance=5,matched=false;
 for(const point of candidates)if(Math.abs(value-point)<distance){closest=point;distance=Math.abs(value-point);matched=true;}
 return {value:closest,snapped:matched};
}
const overlap=(a,b)=>Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*
 Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));
export function precisionEdit(plane,kind,values,{snapTo=false,step=8,neighbours,group=false}={}){
 if(plane.reason)return plane;
 const {style,rect,width,height,absolute}=plane;
 if(!Number.isFinite(step)||step<1||values.length<(kind==='move'?2:1)||!values.every(Number.isFinite))return {reason:'precisionNoSpace'};
 const x=values[0],y=values[1];
 if(kind==='move'){
  if(!absolute)return {reason:style.position==='absolute'?'precisionContainingBlock':'precisionMoveFlow'};
  const maxX=width-rect.width,maxY=height-rect.height;
  if(maxX<0||maxY<0)return {reason:'precisionNoSpace'};
  const nearby=neighbours??(group?{x:[],y:[],boxes:[]}:precisionNeighbours(plane));
  const sx=snap(x,nearby.x,step,snapTo),sy=snap(y,nearby.y,step,snapTo);
  const left=bounded(sx.value,0,maxX),top=bounded(sy.value,0,maxY);
  const before={left:plane.x,top:plane.y,width:rect.width,height:rect.height},after={...before,left,top};
  if(!group&&nearby.boxes.some(other=>overlap(after,other)>overlap(before,other)+.01))return {reason:'precisionCollision'};
  return {properties:{left:px(left),top:px(top),right:'auto',bottom:'auto',margin:'0'},x:left,y:top,guideX:sx.snapped,guideY:sy.snapped};
 }
 if(kind==='gap'&&!['grid','inline-grid','flex','inline-flex'].includes(style.display))return {reason:'precisionGridGap'};
 const max=kind==='width'&&absolute?width-plane.x:kind==='width'?width:kind==='height'&&absolute?height-plane.y:Infinity;
 const min=kind==='width'||kind==='height'?1:0;
 if(max<min||x<0)return {reason:'precisionNoSpace'};
 const snapped=snap(x,[],step,snapTo),amount=bounded(snapped.value,min,max);
 if(absolute&&['width','height'].includes(kind)&&amount>rect[kind]){
  const prior={left:plane.x,top:plane.y,width:rect.width,height:rect.height},after={...prior,[kind]:amount};
  const nearby=neighbours??precisionNeighbours(plane);
  if(nearby.boxes.some(other=>overlap(after,other)>overlap(prior,other)+.01))return {reason:'precisionCollision'};
 }
 if(kind==='width')return {properties:{width:px(amount),'max-width':'100%','min-width':'0','box-sizing':'border-box'},amount};
 if(kind==='height')return {properties:{height:px(amount),'box-sizing':'border-box'},amount};
 if(kind==='padding'){
  const side=Math.min(amount,Math.max(0,rect.width/2-1));return {properties:{padding:px(side),'box-sizing':'border-box'},amount:side};
 }
 if(kind==='gap')return {properties:{gap:px(amount)},amount};
 throw TypeError('Unknown precision operation');
}
export function precisionArrangement(nodes,kind,alignment){
 if(!nodes.length)return {reason:'precisionSelection'};
 const first=nodes[0],parent=first.parentElement;
 if(!parent||nodes.some(n=>n.parentElement!==parent))return {reason:'precisionSiblings'};
 const initial=precisionPlane(first);if(initial.reason)return initial;
 const shapes=[initial,...nodes.slice(1).map(n=>precisionPlane(n,parent))],refusal=shapes.find(s=>s.reason);if(refusal)return refusal;
 if(kind==='caption'){
  const captions=nodes.map(n=>n.matches('figcaption')?n:n.querySelector(':scope > figcaption'));
  if(captions.some(n=>!precisionEligible(n)))return {reason:'precisionCaptionRequired'};
  return {changes:captions.map(node=>({node,properties:{'text-align':alignment}}))};
 }
 const horizontal=kind.endsWith('X'),distribute=kind.startsWith('spread');
 if(shapes.every(s=>s.absolute)){
  if(nodes.length<(distribute?3:2))return {reason:'precisionSelection'};
  const position=horizontal?'x':'y',extent=horizontal?'width':'height',sorted=shapes.toSorted((a,b)=>a[position]-b[position]);
  const start=sorted[0][position],end=shapes.reduce((max,s)=>Math.max(max,s[position]+s.rect[extent]),start),length=end-start;
  const gap=(length-shapes.reduce((sum,s)=>sum+s.rect[extent],0))/(nodes.length-1);
  if(distribute&&gap<0)return {reason:'precisionNoSpace'};
  const changes=[],positions=new Map(),prior=new Map();let cursor=start;
  for(const b of precisionNeighbours(shapes[0]).boxes){positions.set(b.node,b);prior.set(b.node,b);}
  for(const s of sorted){
   const coord=distribute?cursor:alignment==='start'?start:alignment==='end'?end-s.rect[extent]:start+(length-s.rect[extent])/2;
   const result=precisionEdit(s,'move',horizontal?[coord,s.y]:[s.x,coord],{group:true});if(result.reason)return result;
   const original={node:s.node,left:s.x,top:s.y,width:s.rect.width,height:s.rect.height};
   prior.set(s.node,original);positions.set(s.node,{...original,left:result.x,top:result.y});
   changes.push({node:s.node,properties:result.properties});cursor+=s.rect[extent]+gap;
  }
  const axis=horizontal?'left':'top',extentKey=horizontal?'width':'height',ordered=[...positions.values()].sort((a,b)=>a[axis]-b[axis]);
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length&&ordered[j][axis]<ordered[i][axis]+ordered[i][extentKey];j++){
   const a=ordered[i],b=ordered[j];if(overlap(a,b)>overlap(prior.get(a.node),prior.get(b.node))+.01)return {reason:'precisionCollision'};
  }
  return {changes};
 }
 if(shapes.some(s=>s.absolute))return {reason:'precisionSiblings'};
 const layout=local(parent),isGrid=layout.display.includes('grid'),isFlex=layout.display.includes('flex');
 if(!isGrid&&!isFlex)return {reason:'precisionFlowLayout'};
 if(distribute||isFlex&&horizontal===layout.flexDirection.startsWith('row')){
  const siblings=Array.from(parent.children).filter(n=>!n.hasAttribute('data-observanda-editor')&&n.getClientRects().length&&local(n).position!=='absolute');
  if(siblings.length!==nodes.length||!precisionEligible(parent)&&!parent.matches('main')||parent.closest(managedWebsiteContent))return {reason:'precisionWholeGroup'};
  const axis=isGrid?horizontal:isFlex&&horizontal===layout.flexDirection.startsWith('row');
  return {changes:[{node:parent,properties:{[axis?'justify-content':'align-content']:distribute?'space-between':alignment}}]};
 }
 return {changes:nodes.map(node=>({node,properties:{[isGrid&&horizontal?'justify-self':'align-self']:alignment}}))};
}
