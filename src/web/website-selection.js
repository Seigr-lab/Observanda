import {researchId} from './research-reference.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
// Publication choices are a sparse draft of booleans and identities. They are
// not editable research originals and never carry prose or attachment bytes.
export function validWebsiteSelection(value){
 return exact(value,['includeProjects','records',...(Object.hasOwn(value??{},'defaultShare')?['defaultShare']:[])])&&(value.defaultShare===undefined||typeof value.defaultShare==='boolean')&&Array.isArray(value.includeProjects)&&value.includeProjects.every(researchId)&&new Set(value.includeProjects).size===value.includeProjects.length&&
  Array.isArray(value.records)&&new Set(value.records.map(item=>item?.id)).size===value.records.length&&value.records.every(item=>
   exact(item,['id','share','attachments'])&&researchId(item.id)&&(item.share===null||typeof item.share==='boolean')&&Array.isArray(item.attachments)&&new Set(item.attachments.map(a=>a?.id)).size===item.attachments.length&&item.attachments.every(a=>exact(a,['id','share'])&&researchId(a.id)&&typeof a.share==='boolean'));
}
export function websiteRecordShare(selection,record,projectId,choice){
 if(record.share!==true)return false;
 if(choice===undefined)choice=selection.records.find(item=>item.id===record.id);
 return choice?.share??(selection.includeProjects.includes(projectId)?true:selection.defaultShare??record.share);
}
