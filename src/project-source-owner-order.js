// Relative ordering belongs to each represented owner. Moving an unrelated
// entry ahead of a retired project's entries does not change that project.
import {serialize} from './storage-format.js';
export function* projectSourceOwnerOrderChanges(before,after){
 const projectOrders=items=>{const orders=new Map();for(const {id,owner} of items)for(const projectId of owner.kind==='project'?[owner.projectId]:owner.kind==='projects'?owner.projectIds:[]){if(!orders.has(projectId))orders.set(projectId,[]);orders.get(projectId).push(id);}return orders;};
 const left=projectOrders(before),right=projectOrders(after);
 for(const projectId of new Set([...left.keys(),...right.keys()]))if(serialize(left.get(projectId)??[])!==serialize(right.get(projectId)??[]))yield {kind:'project',projectId};
}
