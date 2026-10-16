import {exact,uuid,requireValue} from './validation.js';
export function ownedShape(data,keys){
 return exact(data,Object.hasOwn(data,'projectId')?[...keys,'projectId']:keys)&&(data.projectId==null||uuid(data.projectId));
}
export function checkOwner(tx,data){
 requireValue(data.projectId==null||tx.book.projects.some(p=>p.id===data.projectId),'Choose an existing owner location','MODULE_REFERENCE');
}
