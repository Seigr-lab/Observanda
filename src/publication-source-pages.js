import {publicationSourceCandidates} from './publication-source-candidates.js';
import {websiteRecordShare} from './web/website-selection.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {validPublicationSources} from './web/publication-sources-model.js';
import {PublicationPreviewOwner} from './publication-preview-owner.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {publicationSourcePage} from './publication-source-page.js';

const invalid=()=>{throw new AppError('INVALID');};
const cursorError=()=>{throw new AppError('PUBLICATION_SELECTION_CURSOR');};
// Each request reads one authenticated source and a bounded window. Continuation
// includes the exact consent and immutable snapshot, never a copy of the corpus.
export async function publicationSourcePages(store,snapshot,pinned,host,query,{signal}={}){
 const {source,search,cursor,backward=false}=query;
 if(Object.keys(query).sort().join()!=='backward,cursor,search,snapshotId,source,workspaceId'||!validPublicationSources([source])||source.workspaceId!==snapshot.metadata.id||typeof search!=='string'||search.length>512||typeof backward!=='boolean'||cursor!==null&&(typeof cursor!=='string'||!cursor.length||cursor.length>4096))invalid();
 const identity=digest(serialize({host:host.workspaceId,snapshotId:pinned.snapshotId,source,search})),namespace=source.workspaceId;
 const decode=value=>{try{return store.decode('publication-source-pages',namespace,Buffer.from(value,'base64url'));}catch{cursorError();}};
 const anchor=cursor?decode(cursor):{identity,after:null,backward};
 if(anchor?.identity!==identity||typeof anchor.backward!=='boolean'||anchor.after!==null&&(!Number.isSafeInteger(anchor.after)||anchor.after<0))cursorError();
 const encode=(after,backward)=>store.encode('publication-source-pages',namespace,{identity,after,backward}).toString('base64url');
 const reader={use:async(_id,_revision,consume)=>({value:await consume(store,snapshot,pinned)})};
 const owner=await new PublicationPreviewOwner(source,reader,new PublicationOwnerIdentities(host.workspaceId),{signal}).initialize();
 const metadata=owner.metadata,notebooks=new Set(metadata.notebooks.filter(book=>metadata.projects.some(project=>project.id===book.projectId&&project.share)).map(book=>book.id));
 const boundary=anchor.after,reverse=anchor.backward,needle=search.trim().toLocaleLowerCase();
 const items=[];let first=null,last=null,scanned=0,more=false;
 for await(const candidate of publicationSourceCandidates(store,snapshot,owner,{after:boundary,backward:reverse,search,signal})){
  signal?.throwIfAborted();if(scanned===256||items.length===25){more=true;break;}
  first??=candidate.key;last=candidate.key;scanned++;
  let page;
  if(candidate.historical){
   const descriptor=await owner.describeHistory(candidate.historical),book=owner.projected.notebooks.find(book=>book.id===descriptor.notebookId),project=owner.projected.projects.find(project=>project.id===book?.projectId);
   page={target:'entry:'+descriptor.id,path:'entries/'+descriptor.id+'.html',title:descriptor.title,context:book?.title??'',owner:pinned.owner,recordId:descriptor.recordId,revision:descriptor.revision,record:{id:descriptor.id,title:descriptor.title,notebookId:descriptor.notebookId},project,notebook:book};
   owner.originals.delete(candidate.historical);owner.descriptors.delete(candidate.historical);owner.rows.delete(candidate.historical);
  }else{
   const [summary]=await Array.fromAsync(store.queryDocuments([candidate.row],snapshot.metadata,{signal,search:false,publication:true}));
   if(!notebooks.has(summary.notebookId)||!websiteRecordShare(source.selection,summary,metadata.notebooks.find(book=>book.id===summary.notebookId)?.projectId))continue;
   page=publicationSourcePage(host,{...pinned.owner,projectNamespaceId:pinned.projectNamespaceId},metadata,{...summary,attachments:[]});page.context=page.notebook.title;
  }
  if(needle&&!page.title.toLocaleLowerCase().includes(needle))continue;
  // Only destination labels and addresses escape the selector, never prose.
  items.push({target:page.target,path:page.path,title:page.title,context:page.context,owner:page.owner,recordId:page.recordId,...(page.revision?{revision:page.revision}:{}),record:page.record});
 }
 if(reverse)items.reverse();
 const start=reverse?last:first,end=reverse?first:last;
 return {workspaceId:namespace,snapshotId:pinned.snapshotId,items,
  previousCursor:(reverse?more:boundary!==null)&&start!==null?encode(start,true):null,
  nextCursor:(reverse?boundary!==null:more)&&end!==null?encode(end,false):null};
}
