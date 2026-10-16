import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {recordReferenceCandidates} from './record-reference-candidates.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {publicationLinkResolver} from './publication-prose.js';
import {researchReference} from './web/research-reference.js';
import {recordQueryMatcher} from './web/record-query.js';
import {recordRevision} from './research.js';
import {bookSelectors} from './web/book-selectors.js';

async function* candidates(records,id,anchor){
 const {store,snapshot,metadata,signal}=records,notebooks=new Set(metadata.notebooks.map(n=>n.id));
 const source=recordReferenceCandidates({store,snapshot,notebooks,workspaceId:metadata.id,signal,fallback:({after,backward})=>records.reading.rows(snapshot,notebooks,{signal,order:'position',after:after===null?null:{position:after},backward})},id,anchor);
 const edited=[...records.rows.values()].filter(row=>row&&records.changed.has(row.id)&&(anchor.after===null||(anchor.backward?row.position<anchor.after:row.position>anchor.after))).sort((a,b)=>(a.position-b.position)*(anchor.backward?-1:1));
 let at=0;
 for await(const row of source){
  signal?.throwIfAborted();
  while(at<edited.length&&(edited[at].position-row.position)*(anchor.backward?-1:1)<0)yield edited[at++];
  if(!records.deleted.has(row.id)&&!records.changed.has(row.id))yield row;
 }
 while(at<edited.length){signal?.throwIfAborted();yield edited[at++];}
}

// The unsaved record overlay participates in the same stable reading order as
// saved candidates. Presentation-only edits do not invalidate that position.
export async function websiteReferencePage(records,id,cursor=null){
 const {store,metadata,command,signal}=records;
 if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw new AppError('INVALID');
 const selected=await records.get(id),original=await records.original(id);if(!selected||!original)throw new AppError('NOT_FOUND');
 selected.revision=recordRevision(original);selected.selectors=bookSelectors(original);
 const binding=digest(serialize({workspaceId:metadata.id,websiteId:records.websiteId,snapshot:command.baseEtag,changes:command.changes,removed:command.removed,id}));
 let anchor={after:null,backward:false};
 if(cursor){
  try{anchor=store.decode('website-reference-page',metadata.id,Buffer.from(cursor,'base64url'));}catch{throw new AppError('INVALID');}
  if(!anchor||Object.keys(anchor).sort().join()!=='after,backward,binding'||anchor.binding!==binding||!Number.isSafeInteger(anchor.after)||anchor.after<0||typeof anchor.backward!=='boolean')throw new AppError('INVALID');
 }
 const matches=recordQueryMatcher({relatedTo:{workspaceId:metadata.id,id},referenceNamespaces:selected.referenceNamespaces}),resolve=publicationLinkResolver(metadata.id,{entries:[selected]},{workspaceContent:true});
 const items=[];let scanned=0,first=null,last=null,more=false;
 for await(const row of candidates(records,id,anchor)){
  if(items.length===24||scanned===256){more=true;break;}
  signal?.throwIfAborted();first??=row.position;last=row.position;scanned++;
  const value=await records.document(row);if(!matches(value))continue;
  const details=records.changed.has(row.id)?publicationDescriptor(records.changed.get(row.id)):(await Array.fromAsync(store.queryDocuments([row],metadata,{signal,search:false,publicationDetails:true})))[0].publicationDescriptor;
  if(!details.relations.some(link=>link.target.kind==='record'&&link.target.id===id&&resolve(researchReference(link.target))))continue;
  const descriptor=row.id===id?selected:records.remember(row,value);Object.assign(descriptor,{relations:details.relations,status:details.status,outcome:details.outcome});items.push(row.id);
 }
 const encode=(after,backward)=>store.encode('website-reference-page',metadata.id,{binding,after,backward}).toString('base64url');
 const prior=anchor.after!==null?encode(first??anchor.after,!anchor.backward):null,next=more?encode(last??anchor.after,anchor.backward):null;
 if(anchor.backward)items.reverse();
 return {recordIds:items,scanned,previousCursor:anchor.backward?next:prior,nextCursor:anchor.backward?prior:next};
}
