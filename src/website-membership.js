import {siteProjectIds,validWebsites} from './web/website-sites-model.js';
import {AppError} from './errors.js';

// Hierarchy/removal commands reconcile presentation references in their own
// transaction. Retained editions and original research references stay intact.
export async function reconcileWebsiteMembership(metadata,member,{moved=[]}={}){
 if(!metadata.websites?.length)return;
 const cached=new Map(),read=async id=>{if(!cached.has(id))cached.set(id,await member(id));return cached.get(id);};
 metadata.websites=structuredClone(metadata.websites);
 for(const site of metadata.websites){
  const projects=siteProjectIds(metadata,site.projectId),notebooks=new Set(metadata.notebooks.filter(n=>projects.has(n.projectId)).map(n=>n.id));
  const inside=async id=>{const row=await read(id);return !!row&&notebooks.has(row.notebookId);};
  site.projects=site.projects.filter(p=>projects.has(p.id));site.selection.includeProjects=site.selection.includeProjects.filter(id=>projects.has(id));
  const records=[];for(const choice of site.selection.records)if(await inside(choice.id))records.push(choice);site.selection.records=records;
  for(const id of moved)if(await inside(id)){
   const choice=records.find(r=>r.id===id);if(choice)choice.share=false;else records.push({id,share:false,attachments:[]});
  }
  const valid=async target=>{const [kind,id]=target.split(':');return kind==='project'?projects.has(id):kind==='notebook'?notebooks.has(id):kind==='entry'?inside(id):true;};
  for(const collection of [site.document.branding,site.document.website.layouts,site.document.website.navigation]){
   const kept=[];for(const value of collection)if(await valid(value.target))kept.push(value);collection.splice(0,collection.length,...kept);
  }
  const navigation=site.document.website.navigation,targets=new Set(navigation.map(n=>n.target));for(const item of navigation)if(item.parent&&!targets.has(item.parent))item.parent=null;
 }
 if(!validWebsites(metadata.websites,metadata))throw new AppError('INVALID');
}
