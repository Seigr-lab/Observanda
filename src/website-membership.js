import {publicationPresentationTarget} from './web/publication-presentation-target.js';
import {siteProjectIds,validWebsites} from './web/website-sites-model.js';
import {sameJSONData} from './web/json-data-equality.js';
import {WebsiteDocumentStore} from './website-document-store.js';
import {websiteDocumentLocks} from './website-document-registry.js';
import {AppError} from './errors.js';

// Presentation consent changes only when membership or its project ownership
// changes. Body-only research edits never take the website membership gate.
export function websiteMembershipChange(previous,metadata,before,after,{removed=[]}={}){
 const old=new Map(before.map(row=>[row.id,row])),project=(m,id)=>m.notebooks.find(book=>book.id===id)?.projectId;
 const moved=after.filter(row=>old.has(row.id)&&(old.get(row.id).notebookId!==row.notebookId||project(previous,old.get(row.id).notebookId)!==project(metadata,row.notebookId))).map(row=>row.id);
 const hierarchy=m=>({projects:m.projects.map(({id,parentId})=>({id,parentId:parentId??null})),notebooks:m.notebooks.map(({id,projectId})=>({id,projectId}))});
 return {moved,removed,previous,changed:removed.length>0||moved.length>0||!sameJSONData(hierarchy(previous),hierarchy(metadata))};
}
async function reconcileSite(site,metadata,member,{moved=[],removed=[],previous=metadata}={}){
 const projects=siteProjectIds(metadata,site.projectId),notebooks=new Set(metadata.notebooks.filter(n=>projects.has(n.projectId)).map(n=>n.id));
 const inside=async id=>{const row=await member(id);return !!row&&notebooks.has(row.notebookId);};
 site.projects=site.projects.filter(p=>projects.has(p.id));site.selection.includeProjects=site.selection.includeProjects.filter(id=>projects.has(id));
 const records=[];for(const choice of site.selection.records)if(await inside(choice.id))records.push(choice);site.selection.records=records;
 for(const id of moved)if(await inside(id)){
  const choice=records.find(r=>r.id===id);if(choice)choice.share=false;else records.push({id,share:false,attachments:[]});
 }
 const valid=async target=>{
  const [kind,id]=target.split(':');
  if(kind==='project'){if(projects.has(id))return true;if(previous.projects.some(project=>project.id===id))return false;}
  else if(kind==='notebook'){if(notebooks.has(id))return true;if(previous.notebooks.some(book=>book.id===id))return false;}
  else if(kind==='entry'){const row=await member(id);if(row)return notebooks.has(row.notebookId);if(removed.includes(id))return false;}
  else return true;
  return publicationPresentationTarget(site.document.website,target);
 };
 for(const collection of [site.document.branding,site.document.website.layouts,site.document.website.navigation]){
  const kept=[];for(const value of collection)if(await valid(value.target))kept.push(value);collection.splice(0,collection.length,...kept);
 }
 const navigation=site.document.website.navigation,targets=new Set(navigation.map(n=>n.target));for(const item of navigation)if(item.parent&&!targets.has(item.parent))item.parent=null;
}
// Legacy inline owners retain their exact representation until explicit
// conversion. Hierarchy/removal commands retain their established reconciliation.
export async function reconcileWebsiteMembership(metadata,member,options={}){
 if(!metadata.websites?.length)return;
 metadata.websites=structuredClone(metadata.websites);
 for(const site of metadata.websites)await reconcileSite(site,metadata,member,options);
 if(!validWebsites(metadata.websites,metadata))throw new AppError('INVALID');
}
// The caller holds the research transaction. Acquire the exclusive membership
// gate before reading any independent head; all new heads publish with the new
// research snapshot, while old documents and their source snapshot stay intact.
export async function reconcileOwnedWebsiteMembership(store,researchSnapshotId,snapshot,options){
 if(!options.changed)return;
 await websiteDocumentLocks(store,{membership:'exclusive'});
 const documents=new WebsiteDocumentStore(store),previous=options.previous,metadata=snapshot.metadata;
 const movedBooks=new Set(metadata.notebooks.filter(book=>previous.notebooks.some(old=>old.id===book.id&&old.projectId!==book.projectId)).map(book=>book.id));
 for await(const head of documents.entries()){
  if(head.projectId!==null&&!metadata.projects.some(project=>project.id===head.projectId)){await documents.remove(head.websiteId,{expectedRevision:head.websiteRevision});continue;}
  const current=await documents.read(head.websiteId,{researchSnapshotId,websiteRevision:head.websiteRevision}),site=structuredClone(current.site);
  await reconcileSite(site,metadata,id=>store.member(snapshot,id),options);
  // Moving a whole lab book can change ownership without modifying its records.
  // Explicitly withdraw any inherited project consent for those records too.
  if(movedBooks.size){
   const projects=siteProjectIds(metadata,site.projectId),inside=new Set(metadata.notebooks.filter(book=>movedBooks.has(book.id)&&projects.has(book.projectId)).map(book=>book.id)),selected=new Map(site.selection.records.map(value=>[value.id,value]));
   for await(const row of store.members(snapshot,{notebookIds:inside})){
    const value=selected.get(row.id);if(value)value.share=false;else site.selection.records.push({id:row.id,share:false,attachments:[]});
   }
  }
  if(!sameJSONData(site,current.site))await documents.save(head.websiteId,site,{researchSnapshotId,expectedRevision:head.websiteRevision});
 }
}
