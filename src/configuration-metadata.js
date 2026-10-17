// Snapshot members retain their own configuration roots. A different member's
// descriptor cannot supply settings, even if its blocks exist in this catalogue.
import {isConfigurationReference,validConfigurationReference} from './web/configuration-reference.js';
import {serialize} from './storage-format.js';
import {AppError} from './errors.js';
export function* configurationReferences(metadata){
 for(const project of metadata.projects??[]){const reference=project.labBookTemplate?.configuration;if(isConfigurationReference(reference))yield {owner:{workspaceId:metadata.id,projectId:project.id,notebookId:null,slot:'labBookTemplate'},reference};}
 for(const book of metadata.notebooks??[]){const reference=book.configuration;if(isConfigurationReference(reference))yield {owner:{workspaceId:metadata.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'},reference};}
}
export function assertConfigurationMetadata(metadata){
 for(const {owner,reference} of configurationReferences(metadata))if(!validConfigurationReference(reference,owner))throw new AppError('CATALOGUE_DAMAGED');
}
export async function validateConfigurationChanges(store,before,after,{signal}={}){
 const previous=new Map([...configurationReferences(before??{})].map(({owner,reference})=>[serialize(owner),serialize(reference)]));
 for(const {owner,reference} of configurationReferences(after)){
  if(!validConfigurationReference(reference,owner))throw new AppError('INVALID');
  if(previous.get(serialize(owner))===serialize(reference))continue;
  const {ConfigurationDocuments}=await import('./configuration-documents.js'),documents=new ConfigurationDocuments(store);await documents.validate(await documents.open(owner,reference,{signal,draft:true}),{signal});
 }
}
export async function admitConfigurationMetadata(store,metadata){
 let found=false;for(const {owner,reference} of configurationReferences(metadata)){if(!validConfigurationReference(reference,owner))throw new AppError('INVALID');found=true;}
 if(found){const {requireConfigurationDocuments}=await import('./catalogue-format.js');await requireConfigurationDocuments(store.db);}
}
// A moved book keeps the same schema content and notebook identity. Only the
// authenticated parent slot changes; earlier snapshots retain their old tuple.
export async function reparentConfigurationMetadata(store,before,after,{signal}={}){
 for(const book of after.notebooks??[]){
  if(!isConfigurationReference(book.configuration))continue;
  const source=before.notebooks.find(value=>value.id===book.id);if(!source||serialize(source.configuration)!==serialize(book.configuration))throw new AppError('INVALID');
  const previous={workspaceId:before.id,projectId:source.projectId,notebookId:source.id,slot:'configuration'},owner={workspaceId:after.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'};
  const {ConfigurationDocuments}=await import('./configuration-documents.js'),documents=new ConfigurationDocuments(store),reader=await documents.open(previous,source.configuration,{signal});
  book.configuration=await documents.clone(owner,reader,{signal});
 }
 return after;
}
// A child's project summary is not an independently editable copy of its
// parent's lab-book template. Template application uses the parent's owner.
export function projectSummaryForBook(project){const {labBookTemplate,...summary}=project;return {...summary,parentId:null};}
