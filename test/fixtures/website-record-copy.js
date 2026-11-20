import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {PublicationConversion} from '../../src/publication-conversion.js';

// The copy of a shared lab book record that the website editor places on its
// pages, made by the same conversion and privacy rules as the application.
// A record shared for the first time is seeded; a record saved again after
// that is updated, as the author does from the editor before publishing.
export async function websiteRecordCopy(workspace,record){
 const store=new WebsiteFileStore(workspace),conversion=new PublicationConversion(workspace,{store});
 const {metadata}=await workspace.outline(),notebook=metadata.notebooks.find(item=>item.id===record.notebookId);
 const provenance={workspaceId:metadata.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:record.id},sourceId=websiteSourceId(provenance);
 const existing=await store.scope(()=>store.source(sourceId));
 if(existing?.visible)await conversion.refreshRecord(workspace,provenance);
 // A record its lab book does not share is refused, so it gets no website copy.
 else try{await conversion.seedWebsites([provenance],consume=>workspace.catalogue(async catalogue=>{const snapshotId=await catalogue.head();return consume(catalogue,await catalogue.snapshot(snapshotId),{snapshotId,storage:workspace});}));}
 catch(error){if(error.code==='PUBLICATION_PERMISSIONS_CHANGED')return null;throw error;}
 const source=await store.scope(()=>store.source(sourceId));
 if(!source?.visible)return null;
 // Figures and tables can travel as the copy's own text assets.
 return store.scope(async()=>{
  const html=await store.readText(source.html),css=await store.readText(source.css),assets=[];
  for(const asset of source.assets??[])if(/\.(svg|csv|json|html|txt)$/.test(asset.name??asset.path??''))assets.push(await store.readText(asset));
  return {html,css,assets,text:[html,css,...assets].join('\n'),source};
 });
}
// The website copy as stored now, without updating it from the lab book.
export async function storedRecordCopy(workspace,record){
 const store=new WebsiteFileStore(workspace),{metadata}=await workspace.outline(),notebook=metadata.notebooks.find(item=>item.id===record.notebookId);
 const source=await store.scope(()=>store.source(websiteSourceId({workspaceId:metadata.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:record.id})));
 return source?.visible?store.scope(()=>store.readText(source.html)):null;
}
// A record save made the way the application saves, so sharing changes reach website copies.
export async function saveForWebsites(workspace,record,operation){
 const {metadata}=await workspace.outline();
 return new PublicationConversion(workspace).mutateRecord(workspace,{workspaceId:metadata.id,notebookId:record.notebookId,recordId:record.id},operation);
}
