// Selected checkpoint values use the same domain controls as ordinary authoring.
// Draft validation deliberately permits unfinished values; admission validates
// the final combined record separately.
import {AppError} from './errors.js';
import {selectedRecordValue,replaceRecordValue,recordTypeEditable} from './record-values.js';
import {validRecordValue,validRecordValueField,recordValueFields} from './web/record-value-model.js';
import {validWritingValue} from './web/record-writing-model.js';
import {researchId} from './web/research-reference.js';
import {digest,serialize} from './storage-format.js';
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
export async function selectDraftEdit(document,field,{signal}={}){
 if(validRecordValueField(field))return selectedRecordValue(document,field,{signal});
 let path,definition=null,value;
 if(field==='body'){path=['body'];value={body:(await document.field(path,{signal})).value};}
 else if(typeof field==='string'&&field.startsWith('section:')&&researchId(field.slice(8))){
  for await(const item of document.items(['sections'],{signal}))if((await document.tree.selected(item.value,['id'])).value===field.slice(8)){path=['sections',String(item.index)];break;}
  if(!path)throw new AppError('MISSING');definition=(await document.field(path,{signal})).value;value={title:definition.title,body:definition.body};
 }else if(typeof field==='string'&&/^tag:(0|[1-9][0-9]*)$/.test(field)&&Number.isSafeInteger(Number(field.slice(4)))){
  path=['tags',field.slice(4)];const selected=await document.field(path,{signal});if(!selected.found)throw new AppError('MISSING');value={value:selected.value};
 }else throw new AppError('INVALID');
 return {path,definition,value,revision:digest(serialize(value))};
}
export function validDraftEdit(field,value){
 if(validRecordValueField(field))return validRecordValue(value,field);
 if(field==='body'||field?.startsWith('section:'))return validWritingValue(value,field==='body'?null:field.slice(8));
 return /^tag:(0|[1-9][0-9]*)$/.test(field)&&value&&Object.keys(value).join()==='value'&&(value.value===null||typeof value.value==='string');
}
export async function replaceDraftEdit(document,field,value,selected){
 if(!validDraftEdit(field,value))throw new AppError('INVALID');
 if(validRecordValueField(field))return replaceRecordValue(document,field,value,selected);
 if(field==='body')return document.replace(['body'],value.body);
 if(field.startsWith('section:'))return document.replace(selected.path,{...selected.definition,...value});
 return value.value===null?document.splice(['tags'],Number(field.slice(4)),1,[]):document.replace(selected.path,value.value);
}
