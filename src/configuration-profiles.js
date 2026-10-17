// Dashboard membership reads the pinned configuration index, never a schema tree.
import {ConfigurationDocuments} from './configuration-documents.js';
import {emptyConfiguration} from './web/notebook-schema.js';
import {profileById} from './web/laboratory/catalog.js';
const open=(store,metadata,book,options)=>new ConfigurationDocuments(store).open({workspaceId:metadata.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'},book.configuration??emptyConfiguration(),options);
export async function configurationProfileBooks(store,metadata,books,profile,{signal}={}){
 const selected=[];
 for(const book of books){
  signal?.throwIfAborted();const reader=await open(store,metadata,book,{signal});
  if(profile){if((await reader.item({collection:'profiles',key:profile.id,signal}))?.value.enabled)selected.push(book);}
  else for await(const row of reader.index.rows({collection:'profiles'},{signal})){if(row.value.enabled){selected.push(book);break;}}
 }
 return selected;
}
export async function configurationProfileSummary(store,metadata,book,{signal,limit=8}={}){
 const reader=await open(store,metadata,book,{signal}),profiles=[];let more=false;
 for await(const row of reader.index.rows({collection:'profiles'},{signal})){
  if(!row.value.enabled)continue;if(profiles.length===limit){more=true;break;}profiles.push(row.value.id);
 }
 return {profiles,types:profiles.map(id=>profileById(id)?.label??id),profilesMore:more};
}
