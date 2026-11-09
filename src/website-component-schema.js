import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {attr,put,descendants} from './website-migration-views.js';
import {websiteHTMLByteLimit} from './website-file-policy.js';
import {tokenID} from './web/website-token-model.js';

export const slotMarker='data-website-slot';
export const entryField='data-website-entry-field';
const invalid=()=>{throw new AppError('INVALID');};
const limit=()=>{throw new AppError('LIMIT');};
const label=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=100&&!/[\u0000-\u001f]/u.test(value);
const named=(rows,check)=>{
 if(!Array.isArray(rows))invalid();
 const ids=new Set(),names=new Set();
 for(const row of rows){
  if(!row||!tokenID(row.id)||!label(row.name)||ids.has(row.id))invalid();
  const key=row.name.normalize('NFC').toLowerCase();if(names.has(key))invalid();ids.add(row.id);names.add(key);check(row);
 }
};
export function checkComponentSchema(main){
 if(main.slots!==undefined)named(main.slots,slot=>{
  if(!['text','image','component','entry'].includes(slot.type))invalid();
  const keys=slot.type==='component'?'component,id,name,type':'id,name,type';
  if(Object.keys(slot).sort().join()!==keys||slot.type==='component'&&!tokenID(slot.component))invalid();
 });
 if(main.variants!==undefined)named(main.variants,v=>{if(Object.keys(v).sort().join()!=='id,name,style'||!tokenID(v.style))invalid();});
}
export function componentDependencies(components){
 const remaining=new Map(),parents=new Map(),costs=new Map(),ready=[];
 for(const main of components.values()){
  const children=(main.slots??[]).filter(s=>s.type==='component').map(s=>s.component);
  remaining.set(main.id,children.length);
  costs.set(main.id,{size:Buffer.byteLength(main.html),depth:1});
  if(!children.length)ready.push(main.id);
  for(const id of children){
   const child=components.get(id);if(!child||child.draft&&!main.draft)invalid();
   if(!parents.has(id))parents.set(id,[]);parents.get(id).push(main.id);
  }
 }
 for(let i=0;i<ready.length;i++){
  const id=ready[i],child=costs.get(id);
  for(const parent of parents.get(id)??[]){
   const cost=costs.get(parent);cost.size+=child.size;cost.depth=Math.max(cost.depth,child.depth+1);
   if(cost.size>websiteHTMLByteLimit||cost.depth>256)limit();
   remaining.set(parent,remaining.get(parent)-1);if(!remaining.get(parent))ready.push(parent);
  }
 }
 if(ready.length!==components.size)invalid();
 return parents;
}
export function affectedComponents(parents,id){
 const ids=new Set([id]);for(const child of ids)for(const parent of parents.get(child)??[])ids.add(parent);return ids;
}
export function componentUseCounts(components,instances){
 const counts=new Map(),incoming=new Map(),children=new Map();
 for(const row of instances)counts.set(row.component,(counts.get(row.component)??0)+1);
 for(const id of counts.keys()){
  const deps=(components.get(id)?.slots??[]).filter(s=>s.type==='component').map(s=>s.component);children.set(id,deps);
  for(const child of deps){if(!counts.has(child))counts.set(child,0);incoming.set(child,(incoming.get(child)??0)+1);}
 }
 const queue=[...counts.keys()].filter(id=>!incoming.has(id));
 for(let i=0;i<queue.length;i++){
  const parent=queue[i];for(const child of children.get(parent)){
   counts.set(child,counts.get(child)+counts.get(parent));
   incoming.set(child,incoming.get(child)-1);if(!incoming.get(child))queue.push(child);
  }
 }
 return counts;
}
const containers=new Set(['div','section','article','aside','figure']);
const tags={text:new Set('p h1 h2 h3 h4 h5 h6 span figcaption dt dd caption li strong em small'.split(' ')),image:new Set(['img']),component:containers,entry:containers};
export function componentSlots(root,main){
 const slots=new Map((main.slots??[]).map(s=>[s.id,s])),targets=new Map();
 for(const node of descendants(root)){
  const id=attr(node,slotMarker);if(id===undefined)continue;
  const slot=slots.get(id);
  if(!slot||targets.has(id)||!tags[slot.type].has(node.tagName))invalid();
  if(['component','entry'].includes(slot.type)&&node.childNodes.some(child=>child.nodeName!=='#text'||child.value.trim()))invalid();
  if(slot.type==='text'&&node.childNodes.some(child=>child.nodeName!=='#text'))invalid();
  targets.set(id,node);
 }
 if(targets.size!==slots.size)invalid();return targets;
}
export function checkInstanceOptions(main,row,files,draft){
 const values=row.values??{},slots=new Map((main.slots??[]).map(s=>[s.id,s]));
 if(row.entries!==undefined){
  if(!row.entries||typeof row.entries!=='object'||Array.isArray(row.entries))invalid();
  for(const [field,id] of Object.entries(row.entries))if(slots.get(field)?.type!=='entry'||!/^([a-f0-9]{64})$/.test(id))invalid();
 }
 if(!values||typeof values!=='object'||Array.isArray(values)||row.variant!==undefined&&!main.variants?.some(v=>v.id===row.variant))invalid();
 for(const [id,value] of Object.entries(values)){
  const slot=slots.get(id);if(!slot)invalid();
  if(slot.type==='text'){
   if(typeof value!=='string'||Buffer.byteLength(value)>64*1024)invalid();
  }else if(slot.type==='image'){
   if(!value||typeof value!=='object'||Object.keys(value).sort().join()!=='alt,src'||typeof value.alt!=='string'||value.alt.length>2048)invalid();
   const file=files.get(value.src);
   if(!file||!file.picture||file.sourceId||file.feedAsset||file.draft&&!draft||!/^pictures\/[a-f\d-]{36}\.png$/.test(file.name))invalid();
  }else invalid();
 }
}
export function migrateInstance(row,before,after){
 const slots=new Map((after.slots??[]).map(s=>[s.id,s])),prior=new Map((before.slots??[]).map(s=>[s.id,s.type]));
 for(const id of Object.keys(row.entries??{}))if(slots.get(id)?.type!=='entry')throw new AppError('WEBSITE_COMPONENT_ENTRY_FIELD');
 const retained=Object.fromEntries(Object.entries(row.values??{}).filter(([id])=>slots.get(id)?.type===prior.get(id)));
 const next={...row};if(Object.keys(retained).length)next.values=retained;else delete next.values;
 if(!after.variants?.some(v=>v.id===row.variant))delete next.variant;
 return next;
}
export function shapeComponent(root,main,instance,context){
 const nested=[],targets=componentSlots(root,main);
 for(const slot of main.slots??[]){
  const node=targets.get(slot.id),value=instance.values?.[slot.id];node.attrs=node.attrs.filter(a=>a.name!==slotMarker);
  if(slot.type==='entry')nested.push({node,field:slot.id});
  else if(slot.type==='component'){
   const id=createHash('sha256').update(instance.id+slot.id).digest('hex').slice(0,32);
   nested.push({node,child:context.components.get(slot.component),id});
  }else if(value!==undefined){
   if(slot.type==='text')node.childNodes=[{nodeName:'#text',value,parentNode:node}];
   else{put(node,'src',value.src);put(node,'alt',value.alt);}
  }
 }
 const variant=main.variants?.find(v=>v.id===instance.variant);
 if(variant){
  const classes=new Set((attr(root,'class')??'').split(/\s+/).filter(Boolean));classes.add('ow-token-'+variant.style);put(root,'class',[...classes].join(' '));
 }
 return nested;
}
