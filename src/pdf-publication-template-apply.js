import {AppError} from './errors.js';
import {copiedPdfSectionId} from './pdf-document-copy.js';
import {PublicationTemplates} from './pdf-publication-template-library.js';
import {validPdfDocumentHeader} from './web/pdf-layout-model.js';

const invalid=()=>{throw new AppError('INVALID');};

// Apply the exact released structure inside the document owner's existing
// transaction. All content, note anchors and local changes retain their IDs.
export async function applyPublicationTemplate(owner,{id,operation,current,index,put,signal}){
 const templates=new PublicationTemplates(owner.store),value=await templates.resolve(operation.template),updating=operation.type==='template-update';
 const selected=new Set(operation.slots),available=new Set(value.sections.map(slot=>slot.id));
 if(operation.slots.some(id=>!available.has(id))||!updating&&value.sections.some(slot=>!slot.optional&&!selected.has(slot.id)))invalid();
 if(updating&&(current.starter?.id!==value.id||current.starter.revision===operation.template.revision))throw new AppError('CONFLICT');
 const prior=updating?await templates.value(current.starter.id,current.starter.revision):null;
 if(!updating)current.header={version:1,id,name:operation.name,language:value.language,direction:'auto'};
 if(!updating||operation.settings){
  current.header.layout=value.layout;current.header.structure=value.structure;
  if(value.profile==='standard')delete current.header.outputProfile;else current.header.outputProfile=value.profile;
 }
 if(!validPdfDocumentHeader(current.header))invalid();
 const priorSections=new Map((prior?.sections??[]).map(slot=>[slot.id,slot]));
 const origin=[],existing=new Map((current.starter?.sections??[]).map(row=>[row.slot,row.sectionId]));let level=0;
 for(const slot of value.sections){
  signal?.throwIfAborted();let sectionId=existing.get(slot.id);
  if(sectionId){
   const row=await index.find({root:current.sections},sectionId);
   if(!row)continue; // A locally removed section stays removed.
   if(operation.titles){
    const {section,position}=await owner.sectionRow(id,row.revision,sectionId);
    const before=priorSections.get(slot.id);
    if(before&&section.title===before.title&&slot.title!==before.title)await put({...section,title:slot.title},position);
   }
  }else{
   if(!selected.has(slot.id))continue;
   if(!updating&&slot.level>level+1)invalid();
   sectionId=copiedPdfSectionId(id,slot.id);
   if(await index.find({root:current.sections},sectionId))throw new AppError('CONFLICT');
   await put({id:sectionId,title:slot.title,level:slot.level,content:'',layout:null,start:slot.start},current.nextPosition++);
  }
  origin.push({slot:slot.id,sectionId});level=slot.level;
 }
 if(!origin.length)invalid();
 current.starter={id:value.id,revision:await templates.retain(value),sections:origin};
}
