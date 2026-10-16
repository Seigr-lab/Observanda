import {actionStyle} from './web/website-action-style.js';
import {AppError} from './errors.js';
import {sectionItems} from './web/website-model.js';
import {publicationCollectionRecords} from './web/publication-collections.js';
import {usedAssetIds} from './web/website-layouts.js';

// A page plan is derived only from an admitted projection. It identifies the
// content actually drawn by the shared renderer, including reusable regions.
// Links keep their destinations without preparing the destination's assets.
export function publicationPage(context,target){
 const [kind,id]=target?.split(':')??[],collection={project:'projects',notebook:'notebooks',entry:'entries',page:'pages'}[kind];
 const item=collection&&context[collection].find(value=>value.id===id);
 if(!['home','browse'].includes(target)&&!item||target==='home'&&!context.homeEnabled||target==='browse'&&!context.publicationCounts?.total)throw new AppError('INVALID');
 const path=target==='home'?'index.html':target==='browse'?'browse.html':collection+'/'+id+'.html';
 const layout=context.website.layouts.find(value=>value.target===target),original=layout?.placement!=='replace';
 const regions=context.website.regions.filter(region=>region.target===target);
 const sources=[{region:'layout',sections:layout?.sections??[]},...regions.map(region=>({region:region.kind,sections:region.sections})),
  {region:'',sections:original?(kind==='page'?item.sections:target==='home'?context.website.home.sections:[]):[]}];
 const sections=sources.flatMap(source=>source.sections);
 const media=new Map(),fonts=[context.appearance,context.website.design.buttons,context.website.design.links,...sections.flatMap(s=>[actionStyle(s),actionStyle(s,true)]),...sections.map(section=>section.richText).filter(Boolean)];
 const add=(id,kind)=>{if(media.has(id)&&media.get(id)!==kind)throw new AppError('MEDIA_INVALID');media.set(id,kind);};
 const logos=value=>{for(const logo of value.logos)add(logo.id,'image');};
 const cover=record=>{
  const choice=context.website.presentation.covers.find(value=>value.entryId===record.id);
  const image=choice?record.attachments.find(a=>a.id===choice.attachmentId&&a.kind==='image'):record.attachments.find(a=>a.kind==='image');
  if(image)add(image.id,image.kind);
 };
 logos(context.website);
 for(const {sections,region} of sources)for(const section of sections){
  if(section.kind==='projects')for(const project of sectionItems(section,context,{region}))logos(project);
  if(section.kind==='records')for(const record of sectionItems(section,context,{region}))cover(record);
  if(section.kind==='media'){
   const attachment=context.entries.find(record=>record.id===section.entryId)?.attachments.find(a=>a.id===section.attachmentId);
   if(!attachment)throw new AppError('MEDIA_INVALID');add(attachment.id,attachment.kind);
  }
  for(const id of usedAssetIds([section])){
   const asset=context.website.assets.find(asset=>asset.id===id);
   if(asset)add(asset.id,asset.kind);
  }
 }
 if(original&&item){
  logos(item);
  if(kind==='project'){
   const notebooks=new Set(context.notebooks.filter(n=>n.projectId===id).map(n=>n.id));
   for(const record of publicationCollectionRecords(context,'body',context.recordCards??context.entries))if(notebooks.has(record.notebookId))cover(record);
  }else if(kind==='notebook'){
   for(const record of publicationCollectionRecords(context,'body',context.recordCards??context.entries))if(record.notebookId===id)cover(record);
  }else if(kind==='entry'){
   for(const attachment of item.attachments)add(attachment.id,attachment.kind);
   fonts.push(item.body,...item.sections.map(s=>s.body));
  }
 }
 return {target,path,media,fonts,original,sections};
}
