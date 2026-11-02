// Consent belongs to the research record. Converted website documents contain
// only the permitted parts; these flags are never a substitute for filtering.
export const PUBLICATION_PARTS=Object.freeze(['body','outcome','contributors','tags','figures','results','attempt','template','relations']);
const parts=()=>Object.fromEntries(PUBLICATION_PARTS.map(key=>[key,true]));
export const defaultPublicationPrivacy=()=>({website:parts(),pdf:parts()});
const validParts=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===PUBLICATION_PARTS.length&&PUBLICATION_PARTS.every(key=>typeof value[key]==='boolean');
export const validPublicationPrivacy=value=>value&&Object.keys(value).sort().join()==='pdf,website'&&validParts(value.website)&&validParts(value.pdf);
export const publicationPartAllowed=(record,key,target='website')=>record.publication?.[target]?.[key]!==false;
