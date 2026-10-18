import {researchId} from './research-reference.js';
import {proseDocument,proseText} from './prose-model.js';
import {pdfPageContentBox} from './pdf-page-master-model.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const number=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const natural=value=>Number.isSafeInteger(value)&&value>=0&&value<=12000;
export const PDF_COMPOSITION_PAGE_RESERVE_MM=.1;
export function pdfCompositionKey(target){return target?.kind==='block'?'block:'+target.index:target?.kind==='image'?'image:'+target.id:target?.kind;}
export function validPdfCompositionTarget(target){
 return target?.kind==='block'?exact(target,'kind,index')&&natural(target.index):target?.kind==='image'?exact(target,'kind,id')&&researchId(target.id):exact(target,'kind')&&['title','notes'].includes(target.kind);
}
export function validPdfCompositionBox(value){return exact(value,'target,xMm,yMm,widthMm,heightMm')&&validPdfCompositionTarget(value.target)&&number(value.xMm,0,1000)&&number(value.yMm,0,1000)&&number(value.widthMm,.001,1000)&&number(value.heightMm,.001,1000);}
// Structural admission deliberately preserves a layout made stale by a content
// edit. Export readiness separately proves exact current membership and bounds.
export function validPdfComposition(value){
 if(!exact(value,'version,mode,blockCount,gridMm,snap,boxes')||value.version!==1||value.mode!=='page'||!natural(value.blockCount)||!number(value.gridMm,0,50)||typeof value.snap!=='boolean'||!Array.isArray(value.boxes)||!value.boxes.every(validPdfCompositionBox))return false;
 const keys=new Set();for(const box of value.boxes){const key=pdfCompositionKey(box.target);if(keys.has(key)||box.target.kind==='block'&&box.target.index>=value.blockCount)return false;keys.add(key);}return true;
}
export function pdfCompositionArea(layout){
 if(!layout?.margins)return null;const box=pdfPageContentBox(layout),heightMm=box.heightMm-PDF_COMPOSITION_PAGE_RESERVE_MM;
 return number(box.widthMm,1,1000)&&number(heightMm,1,1000)?{widthMm:box.widthMm,heightMm}:null;
}
export function pdfCompositionItems(section){
 const blocks=proseDocument(section.content).content??[],items=[],images=new Map();
 if(section.title)items.push({key:'title',target:{kind:'title'},label:section.title});
 for(const image of section.images??[]){const at=Math.min(image.position.block,blocks.length);if(!images.has(at))images.set(at,[]);images.get(at).push(image);}
 for(let index=0;index<=blocks.length;index++){
  for(const image of images.get(index)??[])items.push({key:'image:'+image.id,target:{kind:'image',id:image.id},label:image.alt});
  if(index<blocks.length){const node=blocks[index];items.push({key:'block:'+index,target:{kind:'block',index},label:(proseText({type:'doc',content:[node]})||node.attrs?.alternative||node.attrs?.title||'').slice(0,160)});}
 }
 if(section.notes?.some(note=>note.kind==='footnote'))items.push({key:'notes',target:{kind:'notes'},label:''});return items;
}
const inside=(box,area)=>box.xMm+box.widthMm<=area.widthMm+1e-7&&box.yMm+box.heightMm<=area.heightMm+1e-7;
function overlaps(items){
 if(items.length<2)return [];const extent=axis=>{let low=Infinity,high=-Infinity;for(const item of items){low=Math.min(low,item.box[axis]);high=Math.max(high,item.box[axis]);}return high-low;},axis=extent('yMm')>=extent('xMm')?'yMm':'xMm',size=axis==='yMm'?'heightMm':'widthMm',cross=axis==='yMm'?'xMm':'yMm',crossSize=axis==='yMm'?'widthMm':'heightMm',ordered=[...items].sort((a,b)=>a.box[axis]-b.box[axis]),issues=[];let active=[];
 for(const item of ordered){active=active.filter(other=>other.box[axis]+other.box[size]>item.box[axis]+1e-7);for(const other of active)if(other.box[cross]<item.box[cross]+item.box[crossSize]-1e-7&&other.box[cross]+other.box[crossSize]>item.box[cross]+1e-7){issues.push({code:'PDF_COMPOSITION_OVERLAP',target:item.target,other:other.target});if(issues.length===256)return issues;}active.push(item);}return issues;
}
export function pdfCompositionStatus(section,layout){
 const area=pdfCompositionArea(layout),items=pdfCompositionItems(section),composition=section.composition,issues=[];
 if(!composition)return {ready:true,...area,items,issues};
 if(!validPdfComposition(composition))return {ready:false,...area,items,issues:[{code:'PDF_COMPOSITION_STALE',target:null}]};
 if(!area)issues.push({code:'PDF_COMPOSITION_BOUNDS',target:null});
 if(layout?.columns!==1)issues.push({code:'PDF_COMPOSITION_COLUMNS',target:null});
 const boxes=new Map(composition.boxes.map(box=>[pdfCompositionKey(box.target),box])),expected=new Set(items.map(item=>item.key));
 if(composition.blockCount!==(proseDocument(section.content).content??[]).length)issues.push({code:'PDF_COMPOSITION_STALE',target:null});
 const rows=items.map(item=>{const box=boxes.get(item.key);if(!box)issues.push({code:'PDF_COMPOSITION_STALE',target:item.target});else if(area&&!inside(box,area))issues.push({code:'PDF_COMPOSITION_BOUNDS',target:item.target});return {...item,box};});
 for(const box of composition.boxes)if(!expected.has(pdfCompositionKey(box.target)))issues.push({code:'PDF_COMPOSITION_STALE',target:box.target});
 const ready=!issues.length;if(ready)issues.push(...overlaps(rows));return {ready,...area,items:rows,issues};
}
export function pdfCompositionDefaults(section,layout,{gridMm=5,snap=true}={}){
 const area=pdfCompositionArea(layout),items=pdfCompositionItems(section);if(!area)throw new TypeError('Invalid page geometry');
 const slot=area.heightMm/Math.max(1,items.length),gap=Math.min(2,slot/10),boxes=items.map((item,index)=>({target:{...item.target},xMm:0,yMm:index*slot,widthMm:area.widthMm,heightMm:Math.max(.001,slot-gap)}));
 return {version:1,mode:'page',blockCount:(proseDocument(section.content).content??[]).length,gridMm,snap,boxes};
}
// Adjustment is explicit: retain known positions, add new targets, remove stale
// targets, and clamp geometry to the newly selected page. Never run on reads.
export function pdfAdjustComposition(section,layout){
 const old=section.composition,next=pdfCompositionDefaults(section,layout,validPdfComposition(old)?{gridMm:old.gridMm,snap:old.snap}:{}),area=pdfCompositionArea(layout),boxes=new Map((old?.boxes??[]).filter(validPdfCompositionBox).map(box=>[pdfCompositionKey(box.target),box]));
 next.boxes=next.boxes.map(box=>{const prior=boxes.get(pdfCompositionKey(box.target));if(!prior)return box;const widthMm=Math.min(prior.widthMm,area.widthMm),heightMm=Math.min(prior.heightMm,area.heightMm);return {...prior,target:{...prior.target},widthMm,heightMm,xMm:Math.min(prior.xMm,area.widthMm-widthMm),yMm:Math.min(prior.yMm,area.heightMm-heightMm)};});return next;
}
export function pdfMoveCompositionBox(section,layout,key,{xMm,yMm},{snap=true}={}){
 const area=pdfCompositionArea(layout),value=section.composition;if(!area||!validPdfComposition(value)||![xMm,yMm].every(Number.isFinite))return null;
 const selected=value.boxes.find(box=>pdfCompositionKey(box.target)===key);if(!selected||selected.widthMm>area.widthMm||selected.heightMm>area.heightMm)return null;
 const round=number=>snap&&value.snap&&value.gridMm?Math.round(number/value.gridMm)*value.gridMm:number,box={...selected,xMm:Math.max(0,Math.min(round(xMm),area.widthMm-selected.widthMm)),yMm:Math.max(0,Math.min(round(yMm),area.heightMm-selected.heightMm))};return {...value,boxes:value.boxes.map(item=>item===selected?box:item)};
}
