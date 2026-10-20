import {researchId} from './research-reference.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const emptyWebsiteSelection=()=>({includeProjects:[],records:[]});
// Publication choices are a sparse draft of booleans and identities. They are
// not editable research originals and never carry prose or attachment bytes.
export function validWebsiteSelection(value){
 return exact(value,['includeProjects','records',...(Object.hasOwn(value??{},'defaultShare')?['defaultShare']:[])])&&(value.defaultShare===undefined||typeof value.defaultShare==='boolean')&&Array.isArray(value.includeProjects)&&value.includeProjects.every(researchId)&&new Set(value.includeProjects).size===value.includeProjects.length&&
  Array.isArray(value.records)&&new Set(value.records.map(item=>item?.id)).size===value.records.length&&value.records.every(item=>
   exact(item,['id','share','attachments'])&&researchId(item.id)&&(item.share===null||typeof item.share==='boolean')&&Array.isArray(item.attachments)&&new Set(item.attachments.map(a=>a?.id)).size===item.attachments.length&&item.attachments.every(a=>exact(a,['id','share'])&&researchId(a.id)&&typeof a.share==='boolean'));
}
export function websiteRecordShare(selection,record,projectId){
 if(record.share!==true)return false;
 return selection.records.find(item=>item.id===record.id)?.share??(selection.includeProjects.includes(projectId)?true:selection.defaultShare??record.share);
}
export function websiteSelectionDraft(){
 let value=emptyWebsiteSelection(),base=emptyWebsiteSelection();const projects=new Map();
 const record=id=>{let item=value.records.find(r=>r.id===id);if(!item){item={id,share:null,attachments:[]};value.records.push(item);}return item;};
 return {
  snapshot:()=>structuredClone(value),isDirty:()=>JSON.stringify(value)!==JSON.stringify(base),
  load(next,membership={}){if(!validWebsiteSelection(next))throw new TypeError('Invalid website selection');base=structuredClone(next);value=structuredClone(next);projects.clear();for(const [id,projectId] of Object.entries(membership))projects.set(id,projectId);},
  reset(){value=emptyWebsiteSelection();base=emptyWebsiteSelection();projects.clear();},restore(next){if(!validWebsiteSelection(next))throw new TypeError('Invalid website selection');value=structuredClone(next);},
  includeProject(id){if(!value.includeProjects.includes(id))value.includeProjects.push(id);for(const item of value.records)if(projects.get(item.id)===id)item.share=null;value.records=value.records.filter(item=>item.share!==null||item.attachments.length);},
  share(id,share,projectId){if(projectId)projects.set(id,projectId);record(id).share=share;},
  media(id,attachmentId,share){const item=record(id),attachment=item.attachments.find(a=>a.id===attachmentId);if(attachment)attachment.share=share;else item.attachments.push({id:attachmentId,share});},
  projectRecordShare(record,projectId){return websiteRecordShare(value,record,projectId);},
  attachmentShare(recordId,attachment){return attachment.share===true&&(value.records.find(r=>r.id===recordId)?.attachments.find(a=>a.id===attachment.id)?.share??attachment.share);},
  acknowledge(sent){
   value.includeProjects=value.includeProjects.filter(id=>!sent.includeProjects.includes(id));
   value.records=value.records.map(item=>{const saved=sent.records.find(r=>r.id===item.id);if(!saved)return item;return {...item,share:item.share===saved.share?null:item.share,attachments:item.attachments.filter(a=>!saved.attachments.some(s=>s.id===a.id&&s.share===a.share))};}).filter(item=>item.share!==null||item.attachments.length);
  }
 };
}
