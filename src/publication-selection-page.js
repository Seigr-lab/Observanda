// Encrypted continuation belongs to the selected edition, including unsaved
// website choices. It grants no access: the source and privacy checks run again.
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const invalid=()=>{throw new AppError('PUBLICATION_SELECTION_CURSOR');};
export function publicationSelectionPage(store,{snapshotId,websiteId,websitePin,metadata,selection},requested){
 if(!requested)return {page:undefined};
 const identity=metadata.id,query=digest(serialize({snapshotId,websiteId:websiteId??null,websitePin,metadata,selection})),positions=new WeakMap();
 let after=null,offset=requested.offset;
 if(requested.cursor){
  let anchor;
  try{anchor=store.decode('publication-selection-page',identity,Buffer.from(requested.cursor,'base64url'));}catch{invalid();}
  if(!anchor||anchor.version!==1||anchor.query!==query||anchor.offset!==offset||anchor.limit!==requested.limit||
   !Number.isSafeInteger(anchor.after)||anchor.after<0)invalid();
  after=anchor.after;offset=0;
 }
 return {
  page:{...requested,offset,after,remember(record,position){positions.set(record,position);}},
  nextCursor(record,nextOffset){
   const position=positions.get(record);if(!Number.isSafeInteger(position)||position<0)throw new AppError('CATALOGUE_DAMAGED');
   return store.encode('publication-selection-page',identity,{version:1,query,offset:nextOffset,limit:requested.limit,after:position}).toString('base64url');
  }
 };
}
