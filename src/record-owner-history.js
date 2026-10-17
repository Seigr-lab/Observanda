// Imported history is a selected original, never a second lab-book snapshot.
// Its original notebook scope and bytes stay exact while its lookup belongs to
// the destination catalogue. Current lab-book metadata invariants stay strict.
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validMember} from './snapshot-index.js';
import {validRecordOwner} from './record-owner-transfer-state.js';
import {catalogueFormat,catalogueRequiresRecordOwnerTransfers} from './catalogue-format.js';
import {websiteMetadataShell} from './website-owned-metadata.js';
const prefix='record-owner-history:';
const hash=value=>digest(serialize(value));
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function recordOwnerHistoryMetadata(metadata,notebookId,workspaceId){
 const notebook=metadata.notebooks.find(value=>value.id===notebookId);if(!notebook)fail();
 const project=metadata.projects.find(value=>value.id===notebook.projectId);if(!project)fail();
 const value=metadata.formatVersion===21?websiteMetadataShell(metadata):structuredClone(metadata);
 value.id=workspaceId;value.entries=[];value.notebooks=[structuredClone(notebook)];value.projects=[{...structuredClone(project),parentId:null}];
 if(value.pages)value.pages=[];if(value.branding)value.branding=[];delete value.websites;
 if(value.website){value.website={...value.website,navigation:[],layouts:[]};}
 return value;
}
export async function retainRecordOwnerHistory(store,{recordId,sourceOwner,sourceSnapshotId,metadata,member}){
 if(!researchId(recordId)||!validRecordOwner(sourceOwner)||!revisionId(sourceSnapshotId)||!validMember(member)||member.id!==recordId||metadata.id!==(await store.snapshot()).metadata.id)throw new AppError('INVALID');
 const value={version:1,recordId,sourceOwner,sourceSnapshotId,metadata,member},id=hash(value),slot=prefix+id;
 const prior=await store.object(slot);if(prior&&hash(prior)!==id)fail();if(!prior)await store.putObject(slot,value);return id;
}
export async function readRecordOwnerHistory(store,id,recordId){
 if(!revisionId(id)||!researchId(recordId))throw new AppError('INVALID');
 const value=await store.object(prefix+id);if(!value)return null;
 if(!catalogueRequiresRecordOwnerTransfers(await catalogueFormat(store.db))||Object.keys(value).sort().join()!=='member,metadata,recordId,sourceOwner,sourceSnapshotId,version'||value.version!==1||value.recordId!==recordId||hash(value)!==id||!validRecordOwner(value.sourceOwner)||!revisionId(value.sourceSnapshotId)||!validMember(value.member)||value.member.id!==recordId||value.metadata.id!==(await store.snapshot()).metadata.id||value.metadata.entries?.length!==0||!value.metadata.notebooks?.some(book=>book.id===value.member.notebookId))fail();
 return {metadata:value.metadata,records:[value.member],recordOwnerHistory:{id,sourceOwner:value.sourceOwner,sourceSnapshotId:value.sourceSnapshotId}};
}
