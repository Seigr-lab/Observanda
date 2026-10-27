import {AppError} from './errors.js';
import {publicationResearchWorkspace} from './publication-pin.js';
import {openPublicationInput} from './publication-input-reader.js';
import {SOURCE_PUBLICATION_VERSION,sourceRecordAllowed} from './web/source-publication-permissions.js';

const revoked=()=>{throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');};
function assertAllowed(retained,current,metadata){
 if(!current||!sourceRecordAllowed(current,metadata))revoked();
 const sections=new Set((current.sections??[]).filter(section=>section.share===false).map(section=>section.id));
 if((retained.selection?.sections??[]).some(id=>sections.has(id))||(retained.selectors??[]).some(selector=>selector.kind==='section'&&sections.has(selector.sourceId??selector.id)))revoked();
 const media=new Set((current.attachments??[]).filter(item=>item.share===false).map(item=>item.id));
 for(const id of retained.selection?.attachments??[])if(media.has(id))revoked();
}

// A retained edition may survive ordinary text edits. Withdrawal of source
// consent is different: every public entry point rechecks the involved owners.
// Unchanged snapshots avoid record reads; only changed owners visit descriptors.
export function assertPublicationSourcePermissions(workspace,source,{sourceReader,signal,checkedSnapshots}={}){
 return checkSourcePermissions(workspace,source,{sourceReader,signal,checkedSnapshots});
}

// A deployment attempt has one immutable, already captured edition. Admit its
// input once, but recheck current owner heads, source grants and withdrawals
// before every remote write. The reader is never shared across job attempts.
export async function createPublicationPermissionCheck(workspace,source,{sourceReader,signal}={}){
 const host=publicationResearchWorkspace(workspace),input=await host.catalogue(()=>openPublicationInput(workspace,source,{signal})),checkedSnapshots=new Map();
 return ()=>checkSourcePermissions(workspace,source,{sourceReader,signal,checkedSnapshots,input});
}

async function checkSourcePermissions(workspace,source,{sourceReader,signal,checkedSnapshots=new Map(),input=null}={}){
 if(source.sourcePermissionVersion!==SOURCE_PUBLICATION_VERSION)revoked();
 const host=publicationResearchWorkspace(workspace);if(await host.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
 const checkCatalogue=async(store,snapshot,namespace)=>{
  for await(const row of input.records()){
   signal?.throwIfAborted();if((row.sourceWorkspaceId??source.workspaceId)!==namespace)continue;
   const member=await store.member(snapshot,row.recordId??row.id);if(!member)revoked();
   const [current]=await Array.fromAsync(store.queryDocuments([member],snapshot.metadata,{search:false,publicationDetails:true,signal}));
   assertAllowed(row,current,snapshot.metadata);
   if(row.revision!==current.publicationDescriptor.revision)assertAllowed(row,await store.record(member.id,member.revision),snapshot.metadata);
  }
 };
 await host.catalogue(async store=>{
  // Header and collection admission perform many selected node reads. Keep
  // those reads in this one fresh owner snapshot, rather than opening a read
  // transaction for each node. Close it before visiting any foreign owner.
  input??=await openPublicationInput(workspace,source,{signal});
  const head=await store.head();if(head===source.etag||checkedSnapshots.get(source.workspaceId)===head)return;
  await checkCatalogue(store,await store.snapshot(),source.workspaceId);checkedSnapshots.set(source.workspaceId,head);
 });
 const foreign=[];for await(const group of input.sourceGroups())if(group.workspaceId!==source.workspaceId)foreign.push(group);
 if(!foreign.length)return;
 if(typeof sourceReader!=='function')throw new AppError('ACCESS_LOCKED');
 const reader=await sourceReader({signal});
 try{
  for(const group of foreign)await reader.use(group.workspaceId,undefined,async(store,snapshot,pinned)=>{
   if(pinned.snapshotId!==group.snapshotId&&checkedSnapshots.get(group.workspaceId)!==pinned.snapshotId){await checkCatalogue(store,snapshot,group.workspaceId);checkedSnapshots.set(group.workspaceId,pinned.snapshotId);}
  });
  await reader.verify();
 }finally{await reader.close();}
}

// A stale authoring tab may retain public text, but cannot keep displaying a
// source section, record or lab book after its publication consent is withdrawn.
export async function assertPublicationPreviewPermissions(store,snapshotId,metadata,descriptor,{signal}={}){
 if(await store.head()===snapshotId)return;
 const current=await store.snapshot();
 for(const notebook of metadata.notebooks)if(notebook.share!==false&&current.metadata.notebooks.find(book=>book.id===notebook.id)?.share===false)revoked();
 if(!descriptor)return;
 const member=await store.member(current,descriptor.recordId??descriptor.id);if(!member)revoked();
 const [value]=await Array.fromAsync(store.queryDocuments([member],current.metadata,{search:false,publicationDetails:true,signal}));
 const retained={...descriptor,selection:{attachments:(descriptor.media??[]).map(item=>item.id)}};
 assertAllowed(retained,value,current.metadata);
 if(descriptor.revision!==value.publicationDescriptor.revision)assertAllowed(retained,await store.record(member.id,member.revision),current.metadata);
}
