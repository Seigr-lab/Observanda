import {SOURCE_PUBLICATION_VERSION,sourcePublicationRecord} from './source-publication-permissions.js';
import {defaultEditionRecord} from './publication-selection.js';
// Authenticated private labels for edition selection, never a public projection
// or an editable research record. Values, prose and figure points stay excluded.
export function recordEditionInventory(record,revision,{legacy=false}={}){
 if(!legacy)record=sourcePublicationRecord(record);
 const choice=defaultEditionRecord(record,revision);if(legacy){choice.include=true;choice.sections=record.sections.map(section=>section.id);}
 return {...(legacy?{}:{sourcePermissionVersion:SOURCE_PUBLICATION_VERSION}),id:record.id,title:record.title,choice,
  sections:record.sections.map(({id,title})=>({id,title})),fields:(record.template?.fields??[]).map(({key,label})=>({id:key,title:label})),
  attachments:record.attachments.map(({id,kind,caption,alt})=>({id,kind,title:caption||alt||''})),figures:record.figures.map(({id,title})=>({id,title}))};
}
