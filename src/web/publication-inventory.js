import {defaultEditionRecord} from './publication-selection.js';
// Authenticated private labels for edition selection, never a public projection
// or an editable research record. Values, prose and figure points stay excluded.
export function recordEditionInventory(record,revision){
 return {id:record.id,title:record.title,choice:defaultEditionRecord(record,revision),
  sections:record.sections.map(({id,title})=>({id,title})),fields:(record.template?.fields??[]).map(({key,label})=>({id:key,title:label})),
  attachments:record.attachments.map(({id,kind,caption,alt})=>({id,kind,title:caption||alt||''})),figures:record.figures.map(({id,title})=>({id,title}))};
}
