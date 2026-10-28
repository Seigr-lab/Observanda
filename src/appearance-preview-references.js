import {appearanceCursorMetadata} from './appearance-preview-binding.js';
import {AppError} from './errors.js';
import {encodeAppearanceCursor,decodeAppearanceCursor} from './appearance-preview-cursor.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {recordReferenceCandidates} from './record-reference-candidates.js';
import {publicationLinkResolver} from './publication-prose.js';
import {researchReference} from './web/research-reference.js';
import {recordQueryMatcher} from './web/record-query.js';

export function appearanceReferenceQuery(params){
 const cursor=params.get('references');
 if(params.getAll('references').length>1||cursor!==null&&(!cursor||cursor.length>4096))throw new AppError('INVALID');
 params.delete('references');return cursor;
}

// Merge each book's authenticated postings in saved record order. Only one
// frontier per book and a bounded index cache survive between emitted rows.
async function* candidates(records,id,after,backward){
 if(records.referenceRows){yield* records.referenceRows(id,after,backward);return;}
 const {store,snapshot,signal}=records;
 yield* recordReferenceCandidates({store,snapshot,signal,notebooks:records.notebooks,workspaceId:records.metadata.id,fallback:({after,backward})=>records.rows({after:after===null?null:{position:after},backward})},id,{after,backward});
}

export async function appearanceReferencePage(records,id,cursor=null){
 const {store,metadata,signal}=records,selected=await records.get(id);
 if(!selected)throw new AppError('NOT_FOUND');
 const binding=digest(revisionText({snapshot:records.snapshotId,websiteId:records.websiteId,websitePin:records.websitePin,metadata:appearanceCursorMetadata(metadata),selection:records.selection,id}));
 let anchor={after:null,backward:false};
 if(cursor){
  try{anchor=store.decode('appearance-reference-page',metadata.id,decodeAppearanceCursor(cursor));}catch{throw new AppError('INVALID');}
  if(!anchor||Object.keys(anchor).sort().join()!=='after,backward,binding'||anchor.binding!==binding||!Number.isSafeInteger(anchor.after)||anchor.after<0||typeof anchor.backward!=='boolean')throw new AppError('INVALID');
 }
 const matches=recordQueryMatcher({relatedTo:{workspaceId:metadata.id,id:selected.recordId??id},referenceNamespaces:selected.referenceNamespaces}),resolve=publicationLinkResolver(metadata.id,{entries:[selected]});
 const items=[];let scanned=0,first=null,last=null,more=false;
 for await(const row of candidates(records,id,anchor.after,anchor.backward)){
  if(items.length===24||scanned===256){more=true;break;}
  signal?.throwIfAborted();first??=row.position;last=row.position;scanned++;
  if(!await records.visible(row))continue;
  const summary=await records.summary(row,{references:true});
  if(!matches(summary))continue;
  const details=await records.summary(row,{publicationDetails:true});
  if(!details.publicationDescriptor.relations.some(link=>resolve(researchReference(link.target))))continue;
  await records.get(row.id,details);items.push(row.id);
 }
 const encode=(after,backward)=>encodeAppearanceCursor(store.encode('appearance-reference-page',metadata.id,{binding,after,backward}));
 const prior=anchor.after!==null?encode(first??anchor.after,!anchor.backward):null,next=more?encode(last??anchor.after,anchor.backward):null;
 if(anchor.backward)items.reverse();
 return {recordIds:items,scanned,previousCursor:anchor.backward?next:prior,nextCursor:anchor.backward?prior:next};
}
