// Consent belongs to the research record. Converted website documents contain
// only the permitted parts; these flags are never a substitute for filtering.
import {researchId} from './research-reference.js';
export const PUBLICATION_PARTS=Object.freeze(['body','outcome','contributors','tags','figures','results','attempt','template','relations']);
const parts=()=>Object.fromEntries(PUBLICATION_PARTS.map(key=>[key,true]));
export const defaultPublicationPrivacy=()=>({website:parts(),pdf:parts()});
function validParts(value){
 if(!value||typeof value!=='object'||!PUBLICATION_PARTS.every(key=>typeof value[key]==='boolean'))return false;
 if(!Object.hasOwn(value,'hiddenFigures'))return Object.keys(value).length===PUBLICATION_PARTS.length;
 const ids=value.hiddenFigures;
 return Object.keys(value).length===PUBLICATION_PARTS.length+1&&Array.isArray(ids)&&ids.every(researchId)&&new Set(ids).size===ids.length;
}
export const validPublicationPrivacy=value=>value&&Object.keys(value).sort().join()==='pdf,website'&&validParts(value.website)&&validParts(value.pdf);
export const publicationPartAllowed=(record,key,target='website')=>record.publication?.[target]?.[key]!==false;
export const figureSharingId=field=>typeof field==='string'&&field.startsWith('figure-sharing:')&&researchId(field.slice(15))?field.slice(15):null;
export const figurePublicationChoices=(privacy,id)=>({website:!privacy?.website?.hiddenFigures?.includes(id),pdf:!privacy?.pdf?.hiddenFigures?.includes(id)});
export function withFigurePublicationChoices(privacy,id,choices){
 const next={...(privacy??defaultPublicationPrivacy())};
 for(const target of ['website','pdf']){
  const ids=new Set(next[target].hiddenFigures);
  if(choices[target])ids.delete(id);else ids.add(id);
  next[target]={...next[target]};if(ids.size)next[target].hiddenFigures=[...ids].sort();else delete next[target].hiddenFigures;
 }
 return next;
}
// Preserve the authenticated shape of records written before PDF opt-in.
export const privatePublicationFlags=value=>({share:false,...(Object.hasOwn(value,'sharePdf')?{sharePdf:false}:{})});
