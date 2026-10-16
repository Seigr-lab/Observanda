// Source histories keep authenticated record locations after payload retirement.
// Resolving a location requires explicit access to its independently owned project.
import {catalogueFormat} from './catalogue-format.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {ProjectSourceAuthority,validProjectSourceAuthority} from './project-source-authority.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const readers=new AsyncLocalStorage(),format='observanda-retired-record';
const hash=value=>digest(serialize(value));
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const retiredProjectRecord=value=>value?.format===format;
export function projectRecordLocation(receipt,id,revision,notebookId){
 if(!validProjectSourceAuthority(receipt)||!researchId(id)||!revisionId(revision)||!researchId(notebookId))throw new AppError('INVALID');
 return {format,version:1,id,revision,notebookId,owner:structuredClone(receipt)};
}
export function validProjectRecordLocation(value){
 return value&&Object.keys(value).sort().join()==='format,id,notebookId,owner,revision,version'&&retiredProjectRecord(value)&&value.version===1&&researchId(value.id)&&researchId(value.notebookId)&&revisionId(value.revision)&&validProjectSourceAuthority(value.owner);
}
export function withRetiredProjectRecords(source,router,operation){
 if(source?.projectId||!source?.vault?.key||typeof router?.withProject!=='function'||router.registry?.workspace.root!==source.root||router.registry.workspace.vault!==source.vault||typeof operation!=='function')throw new AppError('INVALID');
 return readers.run({source,router},operation);
}
export async function withRetiredProjectCatalogue(store,receipt,target,consume){
 if(store.workspace.projectId||!validProjectSourceAuthority(receipt))fail();
 const authority=new ProjectSourceAuthority(store),source=await authority.receipt(receipt.projectId);
 if(!source||hash(source)!==hash(receipt)||(await store.snapshot()).metadata.id!==receipt.sourceNamespace)fail();
 const context=readers.getStore();if(context?.source.root!==store.workspace.root||context.source.vault!==store.workspace.vault)throw new AppError('ACCESS_LOCKED');
 return context.router.withProject(receipt.projectId,storage=>storage.catalogue(async selected=>{
  if(storage.projectId!==receipt.projectId||storage.vault.id!==receipt.vaultId||(await selected.snapshot()).metadata.id!==receipt.namespaceId)fail();
  const adoption=await selected.object('project:adoption');if(adoption?.version!==1||adoption.ready!==true||hash(adoption.receipt)!==hash(receipt))fail();
  return consume(selected);
 }),{action:'read',target:{projectId:receipt.projectId,domain:'research',...target}});
}
export async function withRetiredProjectOwner(store,receipt,notebookId,target,consume){
 const scope=await new ProjectSourceAuthority(store).read('project-source-authority:notebook:'+notebookId);
 if(scope?.version!==1||scope.notebookId!==notebookId||scope.projectId!==receipt.projectId)fail();
 return withRetiredProjectCatalogue(store,receipt,target,consume);
}
export async function withRetiredProjectRecord(store,location,id,revision,notebookId,consume){
 if(!validProjectRecordLocation(location)||location.id!==id||location.revision!==revision||location.notebookId!==notebookId||typeof consume!=='function')fail();
 return withRetiredProjectOwner(store,location.owner,notebookId,{kind:'record',id},async selected=>{
  const {withStoredRecord}=await import('./record-storage.js');return withStoredRecord(selected,id,revision,consume);
 });
}
export const retiredRecordScopeSlot=(id,generation)=>'project-source-blocks:'+id+':'+generation;
export async function withProjectRecordBlockOwner(store,notebookId,generation,consume,{mutable=false}={}){
 if(!researchId(notebookId)||!Number.isSafeInteger(generation)||generation<1||typeof consume!=='function')throw new AppError('INVALID');
 if(store.workspace.projectId)return consume(store);
 const slot=retiredRecordScopeSlot(notebookId,generation),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!row)return consume(store);
 if(await catalogueFormat(store.db)<23)fail();const value=store.decode('state',slot,row.payload);
 if(!value||Object.keys(value).sort().join()!=='generation,notebookId,owner,version'||value.version!==1||value.notebookId!==notebookId||value.generation!==generation||!validProjectSourceAuthority(value.owner))fail();
 if(mutable)throw new AppError('PROJECT_RELOCATED',[{projectId:value.owner.projectId}]);
 return withRetiredProjectOwner(store,value.owner,notebookId,{kind:'notebook',id:notebookId},consume);
}

// An explicitly owned rekey keeps these locations and their project authority.
// Its verification may use the same authorized reader for the new envelope.
export function withRetiredRecordCopy(source,target,operation){
 const context=readers.getStore();if(source.projectId||!context)return operation();
 if(context.source.root!==source.root||context.source.vault!==source.vault||target.projectId||!target.vault?.key||typeof operation!=='function')throw new AppError('INVALID');
 return readers.run({...context,source:target},operation);
}
