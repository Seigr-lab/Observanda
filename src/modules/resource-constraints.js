import {withScratch} from '../scratch-work.js';
import {stockTracked} from '../web/modules/inventory-model.js';
import {add,negate,compare} from '../web/modules/quantities.js';
import {requireValue} from './validation.js';
export const resourceConstraintTypes=['resource','category','movement','reservation','stock-transfer','asset-transfer'];
export async function validateResourceSource(source){
 await withScratch(async work=>{
  const targets=source.changes&&new Set(),codes=source.changes&&new Map();
  if(source.changes)for(const entity of source.changes.values()){
   const {id,type,data:d}=entity,old=await source.previous(id);
   if(type==='resource'){
    if(!old||['kind','unit','projectId'].some(key=>old.data[key]!==d[key]))targets.add(id);
    if(!old||old.data.code!==d.code||old.data.projectId!==d.projectId){const code=d.code.trim().toLowerCase();if(code){const key=JSON.stringify([d.projectId??null,code]);requireValue(!codes.has(key),'Resource codes must be unique within their owner location');codes.set(key,id);}}
    if(d.categoryId)requireValue(await source.has('category',d.categoryId),'Resource category');
   }else if(resourceConstraintTypes.includes(type)&&d.resourceId){targets.add(d.resourceId);if(old?.data.resourceId)targets.add(old.data.resourceId);}
  }
  if(!codes||codes.size)
  for await(const r of source.all('resource')){
   const code=r.data.code.trim().toLowerCase();
   if(code){const key=JSON.stringify([r.data.projectId??null,code]);requireValue(codes?!codes.has(key)||codes.get(key)===r.id:await work.add('code:'+key),'Resource codes must be unique within their owner location');}
   if(!codes&&r.data.categoryId)requireValue(await source.has('category',r.data.categoryId),'Resource category');
  }
  async function accumulate(resourceId,projectId,physical,reserved){
   const key='balance:'+JSON.stringify([resourceId,projectId]),value=await work.get(key)??{physical:'0',reserved:'0'};
   value.physical=add(value.physical,physical);value.reserved=add(value.reserved,reserved);await work.put(key,value);
  }
  if(!targets||targets.size)for await(const {type,data:d} of source.all(['movement','reservation','stock-transfer','asset-transfer'])){
   if(targets&&!targets.has(d.resourceId))continue;
   const resource=await source.get(d.resourceId);
   if(type==='asset-transfer'){requireValue(resource?.type==='resource'&&!stockTracked(resource.data),'Transferred individual item');continue;}
   requireValue(resource?.type==='resource'&&stockTracked(resource.data)&&resource.data.unit===d.unit,'Stock resource and unit');
   if(type==='stock-transfer'){
    await accumulate(d.resourceId,d.fromProjectId,negate(d.quantity),'0');await accumulate(d.resourceId,d.toProjectId,d.quantity,'0');
   }else{
    const projectId=Object.hasOwn(d,'projectId')?d.projectId:resource.data.projectId??null;
    await accumulate(d.resourceId,projectId,type==='movement'?d.delta:'0',type==='reservation'&&d.status==='active'?d.quantity:'0');
   }
  }
  // Nonnegative stock at every location also establishes a nonnegative total.
  for await(const value of work.items())if(value)requireValue(compare(value.physical,'0')>=0&&compare(add(value.physical,negate(value.reserved)),'0')>=0,'A location cannot use or transfer more than its available stock','STOCK_UNAVAILABLE');
 });
}
