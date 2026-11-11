import {digest,serialize} from './storage-format.js';
import {publicationPartAllowed} from './web/record-publication-privacy.js';

// Content that may affect the approved website fragment. Record bookkeeping
// (including updatedAt) does not invalidate a site's live composition.
const fields=['title','type','occurredOn','status','body','outcome','contributors','template','figures','attempt','results','relations','sections','attachments'];
export function changedFeedField(field){
 if(fields.includes(field))return field;
 const prefix=typeof field==='string'?field.split(':')[0]:'';
 return ({contributor:'contributors',relation:'relations',figure:'figures',result:'results',attempt:'attempt',template:'template',media:'attachments'})[prefix]??null;
}
export async function feedContentStamp(document,publication,{liveFields,selectedId}={}){
 const refs=[];
 for(const field of liveFields??fields){
  if(!publicationPartAllowed({publication},field,'website'))continue;
  if(['sections','attachments','figures'].includes(field)){
   const admitted=[],hidden=field==='figures'?new Set(publication?.website?.hiddenFigures):null;let selected=false;
   for await(const item of document.items([field])){
    const id=(await document.tree.selected(item.value,['id'])).value;if(selectedId&&id!==selectedId)continue;selected=true;
    if(hidden){if(hidden.has(id))continue;admitted.push(item.value);}
    else{
     const allowed=(await document.tree.selected(item.value,['share'])).value;
     if(field==='sections'?allowed===false:allowed!==true)continue;
     // A PDF-only consent edit does not alter the website's input.
     const keys=field==='sections'?['id','title','body']:['id','kind','caption','alt','transcript'];
     admitted.push(await Promise.all(keys.map(key=>document.tree.select(item.value,[key]))));
    }
   }
   // An existing item the website does not admit leaves the site untouched. An
   // absent selected item may be created by this change, so the site is fenced
   // before the research write and compared again after it.
   if(!selectedId||admitted.length||!selected)refs.push([field,admitted]);
  }else refs.push([field,await document.reference([field])]);
 }
 return refs.length?digest(serialize(refs)):null;
}
