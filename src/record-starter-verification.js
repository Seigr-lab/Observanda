import {createHash} from 'node:crypto';
import {RECORD_DRAFT_CHUNK_BYTES} from './web/record-draft-protocol.js';
import {RecordStarters,STARTER_ROOT} from './record-starters.js';
import {RecordDocument} from './record-document.js';
import {StarterValueBlocks,starterDocumentPointer,starterFingerprint,validateStarterDocument} from './record-starter-documents.js';
import {validateStarterRelease} from './record-starter-stream.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {operationItem,operationAdvance} from './operation-progress.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function verifyRecordStarters(workspace,{signal}={}){
 return workspace.catalogue(async()=>{
 const owner=new RecordStarters(workspace),metadata=await workspace.catalogue(async store=>(await store.snapshot()).metadata),workspaceId=metadata.id;
 owner.context=async id=>{if(id!==workspaceId)fail();return metadata;};
 for await(const name of workspace.metadataNames(STARTER_ROOT+'/headers')){
  signal?.throwIfAborted();if(!name.endsWith('.json')||!researchId(name.slice(0,-5)))fail();const header=await owner.header(name.slice(0,-5)),draft=await owner.draftDocument(header);
  operationItem(header.name);const details=await validateStarterDocument(draft,{portable:false,signal});if(details.name!==header.name||await starterFingerprint(draft,{signal})!==header.draftHash)fail();let count=0,latest=false;
  for await(const file of workspace.metadataNames(STARTER_ROOT+'/releases/'+header.id)){
   signal?.throwIfAborted();if(!file.endsWith('.json')||!revisionId(file.slice(0,-5)))fail();const revision=file.slice(0,-5),release=await owner.releaseDocument({workspaceId,id:header.id,release:revision}),metadata=await validateStarterRelease(release,{signal});
   if(await starterFingerprint(release,{signal})!==revision)fail();const history=await owner.object(STARTER_ROOT+'/history/'+header.id+'/'+String(999999999-metadata.number).padStart(9,'0')+'.json');
   if(history?.revision!==revision||history.number!==metadata.number||history.note!==metadata.note||history.createdAt!==metadata.createdAt)fail();count++;if(revision===header.latest){latest=true;if(metadata.number!==header.sequence)fail();const blueprint=new RecordDocument(release.blocks,await release.reference(['blueprint']));if(await starterFingerprint(blueprint,{signal})!==header.releasedDraftHash)fail();}
  }
  if(count!==header.sequence||Boolean(header.latest)!==latest)fail();operationAdvance();
 }
 for await(const name of workspace.metadataNames(STARTER_ROOT+'/packages')){
  signal?.throwIfAborted();if(!name.endsWith('.json')||!researchId(name.slice(0,-5)))fail();const value=await owner.object(STARTER_ROOT+'/packages/'+name),document=new RecordDocument(new StarterValueBlocks(workspace,{staging:name.slice(0,-5)}),value.root);
  await validateStarterRelease(document,{signal});if(await starterFingerprint(document,{signal})!==value.fingerprint)fail();
 }
 // Incomplete capture roots are recoverable drafts; they must be copied with
 // their selected values even though no library entry is visible yet.
 for await(const name of workspace.metadataNames(STARTER_ROOT+'/captures')){
  if(!name.endsWith('.json'))continue;signal?.throwIfAborted();if(!researchId(name.slice(0,-5)))fail();const value=await owner.object(STARTER_ROOT+'/captures/'+name);
  const document=new RecordDocument(new StarterValueBlocks(workspace),value.root);await validateStarterDocument(document,{portable:false,signal});if(await document.tree.arrayLength(document.root,['sections'])!==value.received)fail();
 }
 // Detect retained roots in an old-generation catalogue even if a header was
 // lost. Ordinary header traversal above validates the referenced content.
 for await(const name of workspace.metadataNames(STARTER_ROOT+'/drafts')){const value=await owner.object(STARTER_ROOT+'/drafts/'+name);if(starterDocumentPointer(value)&&!await owner.object(STARTER_ROOT+'/headers/'+name))fail();}
 for await(const name of workspace.metadataNames('.observanda/record-starter-uploads')){
  if(name==='by-file')continue;if(!name.endsWith('.json')||!researchId(name.slice(0,-5)))fail();const content=await owner.object('.observanda/record-starter-uploads/'+name),chunks=new RecordDraftChunks(workspace,name.slice(0,-5),{starter:true});
  const hash=createHash('sha256');for await(const bytes of chunks.chunks(content,{signal,complete:false}))hash.update(bytes);
  if((content.root?.count??0)===Math.ceil(content.bytes/RECORD_DRAFT_CHUNK_BYTES)&&hash.digest('hex')!==content.sha256)fail();operationAdvance();
 }
 });
}
