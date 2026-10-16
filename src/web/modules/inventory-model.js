import {balance,add} from './quantities.js';
import {descendants,locationName} from '../workspace-structure.js';

export const stockTracked=data=>['material','software'].includes(data.kind);
export const assetPlacement=resource=>Object.hasOwn(resource.data,'placementId')?resource.data.placementId:(resource.data.projectId??null);
export const inventoryLocation=(book,id)=>id?locationName(book,id):book.title+' / Central stock';
export const inventoryOwner=(book,id)=>id?locationName(book,id):book.title;
export function inventoryScope(book,projectId=null,recursive=true){
 return projectId?(recursive?descendants(book,projectId):new Set([projectId])):recursive?null:new Set([null]);
}
export function inventoryLocations(entities,resourceId){
 const resource=entities.find(e=>e.type==='resource'&&e.id===resourceId),owner=resource?.data.projectId??null,ids=new Set([owner]);
 for(const {data:d,type} of entities.filter(e=>e.data.resourceId===resourceId)){
  if(['movement','reservation'].includes(type))ids.add(Object.hasOwn(d,'projectId')?d.projectId:owner);
  if(type==='stock-transfer'){ids.add(d.fromProjectId);ids.add(d.toProjectId);}
 }
 return [...ids].map(projectId=>({projectId,...balance(entities,resourceId,new Set([projectId]))}));
}
export function inventoryItems(book,entities,projectId=null,recursive=true){
 return inventoryItemsFor(entities,inventoryScope(book,projectId,recursive));
}
export function inventoryItemsFor(entities,scope){
 if(!scope)return entities;
 const visible=new Set(entities.filter(e=>e.type==='resource').filter(e=>stockTracked(e.data)
  ?inventoryLocations(entities,e.id).some(row=>scope.has(row.projectId))
  :scope.has(assetPlacement(e))).map(e=>e.id));
 return entities.filter(e=>{
  if(e.type==='resource')return visible.has(e.id);
  if(e.type==='category')return true;
  if(e.type==='bom')return scope.has(e.data.projectId);
  if(!visible.has(e.data.resourceId))return false;
  if(['stock-transfer','asset-transfer'].includes(e.type))return scope.has(e.data.fromProjectId)||scope.has(e.data.toProjectId);
  const owner=entities.find(r=>r.id===e.data.resourceId)?.data.projectId??null;
  return scope.has(Object.hasOwn(e.data,'projectId')?e.data.projectId:owner);
 });
}
export const inventoryQuantity=(book,entities,resourceId,projectId=null,recursive=true)=>balance(entities,resourceId,inventoryScope(book,projectId,recursive));

export function inventoryReference(entity,entities){
 if(entity.type==='bom')return {title:entity.data.title,path:'bom/'+entity.id};
 if(['resource','category'].includes(entity.type))return {title:entity.data.name,path:entity.type+'/'+entity.id};
 const resource=entities.find(e=>e.type==='resource'&&e.id===entity.data.resourceId);
 return {title:(resource?.data.name??'Item')+' / '+entity.data.reason,path:'resource/'+entity.data.resourceId};
}

// Usage is documented BOM consumption, not an inference from negative adjustments.
// A location filter follows the stock source, which can differ from the run's project.
export function inventoryBOMUsage(entities,resourceId,scope=null){
 let used='0',scrapped='0';const builds=new Set();
 for(const e of entities.filter(e=>e.type==='bom'&&e.data.status==='finished')){
  const lines=new Set(e.data.lines.filter(l=>l.resourceId===resourceId&&(!scope||scope.has(l.sourceProjectId))).map(l=>l.id));
  if(!lines.size)continue;
  for(const usage of e.data.usage){
   if(!lines.has(usage.lineId))continue;
   used=add(used,usage.used);scrapped=add(scrapped,usage.scrapped);builds.add(e.id);
  }
 }
 return {used,scrapped,builds:builds.size};
}
