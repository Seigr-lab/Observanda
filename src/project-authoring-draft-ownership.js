// Authoring ownership follows saved/base record scopes and the declared lab
// book for a new record. All callers supply one fixed source snapshot.
import {inspectTransferredDraft} from './record-draft-inspection.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {withDraftDocument} from './record-draft-document.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const ownership=()=>{throw new AppError('PROJECT_MIGRATION_OWNERSHIP');};
export async function projectDraftRecordOwner(inventory,{recordId,notebookId,revision=null}){
 const notebook=await inventory.notebook(notebookId),record=await inventory.record(recordId);
 if(!researchId(recordId)||!notebook||notebook.ambiguous||!researchId(notebook.projectId)||record?.ambiguous||record&&record.projectId!==notebook.projectId||revision!==null&&!record)ownership();
 return {projectId:notebook.projectId,selected:notebook.projectId===inventory.projectId};
}
export async function projectDraftOwnership(workspace,inventory,draft,{signal,part}={}){
 signal?.throwIfAborted();if(draft.workspaceId!==inventory.namespaceId)damaged();let selected=null;const projectIds=new Set();
 async function own(value){const current=await projectDraftRecordOwner(inventory,value);if(selected!==null&&selected!==current.selected)ownership();selected=current.selected;projectIds.add(current.projectId);}
 if(draft.formatVersion<=2){for(const change of draft.changes){signal?.throwIfAborted();await own({recordId:change.record.id,notebookId:change.record.notebookId,revision:change.expectedRevision});if(change.base)await own({recordId:change.base.id,notebookId:change.base.notebookId,revision:change.expectedRevision});}}
 else if(draft.document){await workspace.catalogue(store=>withDraftDocument(store,draft,async()=>{}));await own({...draft.base,notebookId:draft.document.notebookId});}
 else {const inspected=await inspectTransferredDraft(workspace,draft.id,draft.content,{signal,ownership:true,part});if(inspected.base.recordId!==draft.base.recordId||inspected.base.revision!==draft.base.revision||inspected.title!==draft.titles[0])damaged();await own({...draft.base,notebookId:inspected.notebookId});}
 return {selected,projectIds:[...projectIds]};
}
export async function projectDraftTransferOwnership(workspace,inventory,manifest,current,options={}){
 if(manifest.workspaceId!==inventory.namespaceId)damaged();
 if(manifest.receipt&&current?.revision===manifest.receipt.revision)return projectDraftOwnership(workspace,inventory,current.draft,options);
 // Older transports do not identify their owner until all authenticated bytes
 // are present. An existing checkpoint does not authorize a replacement owner.
 if(!new RecordDraftChunks(workspace,manifest.id).valid(manifest.content))throw new AppError('PROJECT_MIGRATION_DRAFT_INCOMPLETE');
 const inspected=await inspectTransferredDraft(workspace,manifest.id,manifest.content,{...options,ownership:true}),fact=await projectDraftRecordOwner(inventory,{...inspected.base,notebookId:inspected.notebookId});
 const projectIds=new Set([fact.projectId]);if(current){const previous=await projectDraftOwnership(workspace,inventory,current.draft,options);if(previous.selected!==fact.selected)ownership();for(const id of previous.projectIds)projectIds.add(id);}
 return {selected:fact.selected,projectIds:[...projectIds]};
}
