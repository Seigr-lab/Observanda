import {AppError} from './errors.js';
import {hasHomepage} from './web/website-layouts.js';
import {publicSections,sectionItems} from './web/website-model.js';
import {REGION_SLOTS,resolveRegion} from './web/website-regions.js';

// Planning uses authenticated identities, dates, tags and attachment IDs only.
// These descriptors never pass as originals into validation or rendering.
export function websitePageRecords(metadata,descriptors,target){
 if(typeof target!=='string'||! /^(home|(?:page|project|notebook|entry):[a-f0-9-]{36})$/.test(target))throw new AppError('INVALID');
 const [kind,id]=target.split(':'),selection={...metadata,homeEnabled:hasHomepage(metadata),assets:metadata.website.assets,entries:descriptors};
 const collection={project:'projects',notebook:'notebooks',entry:'entries',page:'pages'}[kind];
 const item=collection&&selection[collection].find(v=>v.id===id);
 if(target==='home'?!selection.homeEnabled:!item)throw new AppError('INVALID');
 const layout=metadata.website.layouts.find(l=>l.target===target),original=layout?.placement!=='replace',needed=new Set(),cards=new Set();
 const sections=[],sources=[layout?.sections??[],...REGION_SLOTS.map(kind=>resolveRegion(metadata.website,target,kind)?.sections??[])];
 if(original)sources.push(target==='home'?metadata.website.home.sections:kind==='page'?item.sections:[]);
 for(const source of sources)for(const section of publicSections(source,selection,{includeUnpublished:true,editing:true})){
  sections.push(section);
  if(section.kind==='records')for(const record of sectionItems(section,selection))cards.add(record.id);
  if(section.kind==='media')needed.add(section.entryId);
 }
 if(kind==='entry'){
  needed.add(id);
  // The selected original's contextual journeys may name runs/comparisons.
  // Current summaries identify their sources without reading unrelated bodies.
  for(const record of descriptors)if(record.referencesSelected)needed.add(record.id);
 }else if(original&&(kind==='project'||kind==='notebook')){
  const notebooks=new Set(kind==='notebook'?[id]:metadata.notebooks.filter(n=>n.projectId===id).map(n=>n.id));
  for(const record of descriptors)if(notebooks.has(record.notebookId))cards.add(record.id);
 }
 return {records:needed,cards,sections};
}
