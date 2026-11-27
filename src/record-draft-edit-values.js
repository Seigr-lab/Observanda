// Selected checkpoint values use the same domain controls as ordinary authoring.
// Draft validation deliberately permits unfinished values; admission validates
// the final combined record separately.
import {AppError} from './errors.js';
import {selectedRecordValue,replaceRecordValue,recordTypeEditable} from './record-values.js';
import {validRecordValue,validRecordValueField,recordValueFields} from './web/record-value-model.js';
import {validWritingValue} from './web/record-writing-model.js';
import {researchId} from './web/research-reference.js';
import {digest,serialize} from './storage-format.js';
import {placedFigures} from './web/book-selectors.js';
export const draftEditGroups={details:null,writing:['sections'],custom:['template','fields'],contributors:['contributors'],relations:['relations'],media:['attachments'],figures:['figures'],preparations:['attempt','preparations'],events:['attempt','events'],assessments:['attempt','assessments'],results:['results','statements'],tags:['tags']};
const fieldPrefix={contributors:'contributor',relations:'relation',media:'media',figures:'figure',preparations:'attempt:preparation',events:'attempt:event',assessments:'attempt:assessment',results:'result'};
export async function draftEditFields(document,group,offset,{signal}={}){
 if(!Object.hasOwn(draftEditGroups,group)||!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');
 if(group==='details'){
  const type=await recordTypeEditable(document,{signal}),fields=recordValueFields.filter(field=>field!=='type'||type);
  return {offset:0,total:fields.length,next:null,items:fields.map(field=>({field,label:field,localized:true}))};
 }
 const path=draftEditGroups[group],exists=await document.tree.select(document.root,path),count=exists?await document.tree.arrayLength(document.root,path):0,total=count+(group==='writing'?1:0),items=[];
 for(let position=offset;position<Math.min(offset+8,total);position++){
  signal?.throwIfAborted();
  if(group==='writing'&&position===0){items.push({field:'body',label:'summary',localized:true});continue;}
  const index=position-(group==='writing'?1:0),ref=await document.reference([...path,String(index)]),read=key=>document.tree.selected(ref,[key]).then(r=>r.value);
  if(group==='tags'){items.push({field:'tag:'+index,label:await document.tree.read(ref)});continue;}
  const id=await read(group==='custom'?'key':'id'),field=group==='writing'?'section:'+id:group==='custom'?'template:'+id:fieldPrefix[group]+':'+id;
  const label=await read(group==='custom'?'label':group==='contributors'?'name':group==='relations'?'label':'title');
  items.push({field,label:typeof label==='string'?label:'',position:index});
 }
 return {offset,total,next:offset+8<total?offset+8:null,items};
}
// A draft's section structure, edited by insert, move and remove like a saved record's
// (record-section-commands.js); its revision is the order of the section identities.
async function sectionIds(document,{signal}={}){const ids=[];for await(const item of document.items(['sections'],{signal}))ids.push((await document.tree.selected(item.value,['id'])).value);return ids;}
const validSectionEdit=value=>{
 if(!value||typeof value!=='object'||!researchId(value.sectionId))return false;
 if(value.action==='insert')return Object.keys(value).sort().join()==='action,beforeId,sectionId,value'&&(value.beforeId===null||researchId(value.beforeId))&&validWritingValue(value.value,value.sectionId);
 if(value.action==='remove')return Object.keys(value).sort().join()==='action,sectionId';
 return value.action==='move'&&Object.keys(value).sort().join()==='action,position,sectionId'&&Number.isSafeInteger(value.position)&&value.position>=0;
};
// A draft's files, attached, moved and removed as a saved record's are
// (record-media-commands.js); its revision is the order of the attachment identities.
async function attachmentIds(document,{signal}={}){const ids=[];for await(const item of document.items(['attachments'],{signal}))ids.push((await document.tree.selected(item.value,['id'])).value);return ids;}
const validAttachmentEdit=value=>{
 if(!value||typeof value!=='object'||!researchId(value.mediaId))return false;
 if(value.action==='attach')return Object.keys(value).sort().join()==='action,kind,mediaId'&&['image','audio','video'].includes(value.kind);
 if(value.action==='remove')return Object.keys(value).sort().join()==='action,mediaId';
 return value.action==='move'&&Object.keys(value).sort().join()==='action,mediaId,position'&&Number.isSafeInteger(value.position)&&value.position>=0;
};
export async function selectDraftEdit(document,field,{signal}={}){
 if(validRecordValueField(field))return selectedRecordValue(document,field,{signal});
 let path,definition=null,value;
 if(field==='sections'){path=['sections'];value={ids:await sectionIds(document,{signal})};}
 else if(field==='attachments'){path=['attachments'];value={ids:await attachmentIds(document,{signal})};}
 else if(field==='body'){path=['body'];value={body:(await document.field(path,{signal})).value};}
 else if(typeof field==='string'&&field.startsWith('section:')&&researchId(field.slice(8))){
  for await(const item of document.items(['sections'],{signal}))if((await document.tree.selected(item.value,['id'])).value===field.slice(8)){path=['sections',String(item.index)];break;}
  if(!path)throw new AppError('MISSING');definition=(await document.field(path,{signal})).value;value={title:definition.title,body:definition.body};
 }else if(typeof field==='string'&&/^tag:(0|[1-9][0-9]*)$/.test(field)&&Number.isSafeInteger(Number(field.slice(4)))){
  // The position just after the last tag is a new tag.
  path=['tags',field.slice(4)];const selected=await document.field(path,{signal});
  if(!selected.found){const tags=await document.tree.select(document.root,['tags'])?await document.tree.arrayLength(document.root,['tags']):0;if(Number(field.slice(4))!==tags)throw new AppError('MISSING');definition={added:true};}
  value={value:selected.found?selected.value:null};
 }else throw new AppError('INVALID');
 return {path,definition,value,revision:digest(serialize(value))};
}
export function validDraftEdit(field,value){
 if(validRecordValueField(field))return validRecordValue(value,field);
 if(field==='sections')return validSectionEdit(value);
 if(field==='attachments')return validAttachmentEdit(value);
 if(field==='body'||field?.startsWith('section:'))return validWritingValue(value,field==='body'?null:field.slice(8));
 return /^tag:(0|[1-9][0-9]*)$/.test(field)&&value&&Object.keys(value).join()==='value'&&(value.value===null||typeof value.value==='string');
}
export async function replaceDraftEdit(document,field,value,selected){
 if(!validDraftEdit(field,value))throw new AppError('INVALID');
 if(validRecordValueField(field))return replaceRecordValue(document,field,value,selected);
 if(field==='sections'){
  const ids=selected.value.ids,index=ids.indexOf(value.sectionId);
  if(value.action==='insert'){
   const before=value.beforeId===null?ids.length:ids.indexOf(value.beforeId);
   if(index>=0||before<0)throw new AppError('INVALID');
   return document.splice(['sections'],before,0,[{id:value.sectionId,...value.value}]);
  }
  if(index<0)throw new AppError('MISSING');
  if(value.action==='remove')return document.splice(['sections'],index,1,[]);
  if(value.position>=ids.length)throw new AppError('INVALID');
  const before=value.position+(value.position>index?1:0);if(before===index||before===index+1)return document;
  const section=(await document.field(['sections',String(index)])).value,removed=await document.splice(['sections'],index,1,[]);
  return removed.splice(['sections'],index<before?before-1:before,0,[section]);
 }
 if(field==='attachments'){
  const ids=selected.value.ids,index=ids.indexOf(value.mediaId);
  if(value.action==='attach'){if(index>=0)throw new AppError('INVALID');return document.splice(['attachments'],ids.length,0,[{id:value.mediaId,kind:value.kind,caption:'',alt:'',transcript:'',share:false}]);}
  if(index<0)throw new AppError('MISSING');
  if(value.action==='remove'){
   // A file placed in the summary or a section stays until it is taken out of the writing.
   const inUse=body=>placedFigures({body}).has(value.mediaId);
   if(inUse((await document.field(['body'])).value))throw new AppError('MEDIA_IN_USE');
   for await(const item of document.items(['sections']))if(inUse((await document.tree.selected(item.value,['body'])).value))throw new AppError('MEDIA_IN_USE');
   return document.splice(['attachments'],index,1,[]);
  }
  if(value.position>=ids.length)throw new AppError('INVALID');if(value.position===index)return document;
  const item=(await document.field(['attachments',String(index)])).value;
  return (await document.splice(['attachments'],index,1,[])).splice(['attachments'],value.position,0,[item]);
 }
 if(field.startsWith('tag:')&&selected.definition?.added){if(value.value===null)throw new AppError('INVALID');return document.splice(['tags'],Number(field.slice(4)),0,[value.value]);}
 if(field==='body')return document.replace(['body'],value.body);
 if(field.startsWith('section:'))return document.replace(selected.path,{...selected.definition,...value});
 return value.value===null?document.splice(['tags'],Number(field.slice(4)),1,[]):document.replace(selected.path,value.value);
}
