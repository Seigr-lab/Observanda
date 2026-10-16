import {proseText} from './prose-model.js';
export function publicationExcerpt(value){
 const text=proseText(value).replace(/\s+/g,' ').trim();
 if(text.length<=240)return text;
 const cut=text.slice(0,237),space=cut.lastIndexOf(' ');
 return cut.slice(0,space>0?space:cut.length)+'\u2026';
}
// An authenticated display derivative, never an editable or exportable original.
// Covers need image descriptions but never transcripts or the full record prose.
export function publicationCard(record){
 const {id,title,notebookId,occurredOn,status,tags}=record;
 return {id,title,notebookId,occurredOn,status,tags,type:record.template?.label??record.type,
  excerpt:publicationExcerpt(record.body),hasBody:Boolean(record.body),
  attachments:record.attachments.filter(a=>a.kind==='image').map(({id,kind,caption,alt,share})=>({id,kind,caption,alt,share}))};
}
