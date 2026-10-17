// Offline sharing carries the existing immutable configuration graph. Its
// signed selection supplies the exact owner; transport names grant no scope.
import {createHash} from 'node:crypto';
import {ConfigurationDocuments,ConfigurationReader,configurationDocumentNodes} from '../configuration-documents.js';
import {ConfigurationValueBlocks} from '../configuration-block-store.js';
import {ConfigurationIndex} from '../configuration-index.js';
import {RecordDocument} from '../record-document.js';
import {RecordValueTree} from '../record-value-tree.js';
import {configurationReferences} from '../configuration-metadata.js';
import {isConfigurationReference,validConfigurationReference} from '../web/configuration-reference.js';
import {requireConfigurationDocuments} from '../catalogue-format.js';
import {digest,serialize} from '../storage-format.js';
import {withScratch} from '../scratch-work.js';
import {identityHash} from './identity.js';
import {AppError} from '../errors.js';

const fail=()=>{throw new AppError('COLLABORATION_PACKAGE');};
const pattern=/^\.observanda\/configuration-blocks\/(value|index)\/([a-f0-9]{64})\.json$/;
export const configurationPartName=name=>typeof name==='string'&&pattern.test(name);
const nameOf=(kind,revision)=>'.observanda/configuration-blocks/'+kind+'/'+revision+'.json';
export function hasSharedConfigurations(metadata){for(const ignored of configurationReferences(metadata)){void ignored;return true;}return false;}

// Only unpublished initialization uses this shell. populateSharedWorkspace
// installs the exact selection before initialization verifies or publishes it.
export function configurationBootstrap(metadata){
 const value=structuredClone(metadata);
 for(const book of value.notebooks)if(isConfigurationReference(book.configuration))delete book.configuration;
 for(const project of value.projects)if(isConfigurationReference(project.labBookTemplate?.configuration))delete project.labBookTemplate;
 return value;
}
export async function collectConfigurations(workspace,metadata,emit,{signal}={}){
 if(!hasSharedConfigurations(metadata))return;
 await workspace.catalogue(async store=>{
  const documents=new ConfigurationDocuments(store);
  for(const {owner,reference} of configurationReferences(metadata)){
   const reader=await documents.open(owner,reference,{signal});await documents.validate(reader,{signal});
   for await(const {kind,revision,node} of configurationDocumentNodes(reader.document,reference.root,reference.index.root,{signal})){
    await emit({kind:'metadata',name:nameOf(kind,revision),content:JSON.stringify(node)});
   }
  }
 });
}
class PackageBlocks{
 constructor(parts,signal){this.parts=parts;this.signal=signal;this.cache=new Map();}
 tree(){return new RecordValueTree(this);}
 // Selected inline references compute identities only; every subsequent read
 // must still find authenticated bytes in the package, never an invented node.
 async put(kind,node){this.signal?.throwIfAborted();if(!['value','index'].includes(kind)||Buffer.byteLength(serialize(node))>65536)fail();return digest(serialize(node));}
 async read(kind,revision){
  this.signal?.throwIfAborted();const name=nameOf(kind,revision);if(!configurationPartName(name))fail();
  if(this.cache.has(name))return structuredClone(this.cache.get(name));
  const info=await this.parts.descriptor('metadata',name);if(!info||info.size>65536)fail();
  const node=await this.parts.value('metadata',name);if(Buffer.byteLength(serialize(node))>65536||digest(serialize(node))!==revision)fail();
  while(this.cache.size>=64)this.cache.delete(this.cache.keys().next().value);this.cache.set(name,structuredClone(node));return node;
 }
}
// The review selects the package and notebook. Clients supply neither owner
// tuples nor graph roots, and legacy values remain a private read overlay.
export async function openPackageConfiguration(parts,selection,notebookId,{signal}={}){
 signal?.throwIfAborted();const notebook=selection.metadata.notebooks.find(value=>value.id===notebookId);if(!notebook)fail();
 const value=notebook.configuration;if(value===undefined)return null;
 const owner={workspaceId:selection.metadata.id,projectId:notebook.projectId,notebookId,slot:'configuration'},documents=new ConfigurationDocuments(null);
 if(!isConfigurationReference(value))return documents.open(owner,value,{signal});
 if(!validConfigurationReference(value,owner))fail();
 const blocks=new PackageBlocks(parts,signal),document=new RecordDocument(blocks,value.root);
 await documents.validateShape(document,{signal});
 return new ConfigurationReader(owner,document,value,new ConfigurationIndex(document,value.index),{signal});
}
// One encrypted scratch ledger proves exact reachability without a graph-sized
// JS set. A valid sender may not append unrelated configuration state.
export async function verifyPackageConfigurations(parts,metadata,options={}){
 const read=()=>checkPackageConfigurations(parts,metadata,options);
 // Import holds a different owner's writer. Keep package graph reads on one
 // authenticated source snapshot instead of reopening it for every node.
 return parts.workspace&&await parts.workspace.storageKind()==='catalogue'?parts.workspace.catalogue(read):read();
}
async function checkPackageConfigurations(parts,metadata,{signal,onNode}={}){
 if(!hasSharedConfigurations(metadata)){
  for await(const item of parts.items())if(item.kind==='metadata'&&configurationPartName(item.name))fail();return;
 }
 return withScratch(async seen=>{
  const blocks=new PackageBlocks(parts,signal),documents=new ConfigurationDocuments(null);
  for(const {owner,reference} of configurationReferences(metadata)){
   if(!validConfigurationReference(reference,owner))fail();
   const document=new RecordDocument(blocks,reference.root),reader=new ConfigurationReader(owner,document,reference,new ConfigurationIndex(document,reference.index));
   await documents.validate(reader,{signal});
   for await(const entry of configurationDocumentNodes(document,reference.root,reference.index.root,{signal})){
    if(await seen.add(nameOf(entry.kind,entry.revision)))await onNode?.(entry);
   }
  }
  for await(const item of parts.items())if(item.kind==='metadata'&&configurationPartName(item.name)&&!await seen.has(item.name))fail();
 },{signal});
}
export async function admitConfigurations(workspace,parts,metadata,{signal}={}){
 if(!hasSharedConfigurations(metadata))return verifyPackageConfigurations(parts,metadata,{signal});
 return workspace.catalogue(async store=>{
  await requireConfigurationDocuments(store.db);const blocks=new ConfigurationValueBlocks(store,{signal});
  await verifyPackageConfigurations(parts,metadata,{signal,onNode:async({kind,revision,node})=>{if(await blocks.put(kind,node)!==revision)fail();}});
  await blocks.flush();
 });
}
async function structureHash(store,metadata,{signal}={}){
 const projected=structuredClone(metadata),documents=new ConfigurationDocuments(store);
 for(const book of projected.notebooks){
  if(book.configuration===undefined)continue;
  const owner={workspaceId:metadata.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'},reader=await documents.open(owner,book.configuration,{signal}),hash=createHash('sha256');
  for await(const chunk of reader.document.tree.json(reader.document.root,{canonical:true,signal}))hash.update(chunk);
  book.configuration={contentHash:hash.digest('hex')};
 }
 return identityHash(projected);
}
// Local inline-to-reference conversion does not change owner-controlled
// structure. Canonical JSON is streamed; wrapper hashes are not schema values.
export async function matchingSharedStructure(workspace,current,baseline,{signal}={}){
 if(!hasSharedConfigurations(current)&&!hasSharedConfigurations(baseline))return identityHash(current)===identityHash(baseline);
 return workspace.catalogue(async store=>(await structureHash(store,current,{signal}))===(await structureHash(store,baseline,{signal})));
}
