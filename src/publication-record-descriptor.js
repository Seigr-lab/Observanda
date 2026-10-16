import {recordRevision} from './research.js';
import {publicationCard} from './web/publication-card.js';
import {publicationRecordText} from './publication-prose.js';
import {bookSelectors} from './web/book-selectors.js';
import {readingJourney} from './web/book-journeys.js';
import {proseReferences} from './web/prose-model.js';
import {attemptReferences} from './web/attempt-model.js';

// A revision-bound derivative for cards and links, never a research original.
// Selection is checked by the caller before exposing this private index value.
export function publicationDescriptor(record,metadata){
 const card=publicationCard({...record,body:publicationRecordText(record.body,record,()=>null)});card.attachments=card.attachments.filter(a=>a.share);
 if(metadata){const choice=metadata.website.presentation.covers.find(c=>c.entryId===record.id),image=choice?card.attachments.find(a=>a.id===choice.attachmentId):card.attachments[0];card.attachments=image?[image]:[];}
 return {...card,journey:readingJourney(record),selectors:bookSelectors({...record,attachments:record.attachments.filter(a=>a.share)}),share:true,revision:recordRevision(record),outcome:record.outcome??'',relations:[...record.relations.map(({role,target})=>({role:role??'related',target})),...[record.body,...record.sections.map(s=>s.body)].flatMap(proseReferences).map(target=>({role:'mention',target}))],
  references:attemptReferences(record.attempt).filter(r=>r.kind==='record').map(({workspaceId,kind,id,revision})=>({workspaceId,kind,id,revision})),
  media:record.attachments.filter(a=>a.share).map(({id,kind})=>({id,kind,share:true}))};
}
