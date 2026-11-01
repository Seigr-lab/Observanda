import {publicationOwnerId} from './publication-owner-identities.js';
import {publicationPresentationSections} from './publication-input-presentation.js';
import {proseReferences} from './web/prose-model.js';

// This proof concerns one canvas page, never publication/export admission.
// Global navigation and discovery genuinely depend on every selected owner.
// Dedicated book namespaces can be ruled out without opening their catalogues;
// legacy/project namespaces may contain several books and remain conservative.
export function websitePreviewOwnerDemand(metadata,target){
 const all=()=>({includes:()=>true}),none=()=>({includes:()=>false});
 if(!target||metadata.website.design.navigation!=='none')return all();
 const [kind,id]=target.split(':');if(kind==='entry'||kind==='project')return all();
 const internal=href=>typeof href==='string'&&/^(?:entry:|project:|notebook:|observanda:)/.test(href);
 const linked=node=>internal(node?.attrs?.href)||(node?.marks??[]).some(mark=>internal(mark.attrs?.href))||(node?.content??[]).some(linked);
 for(const {sections} of publicationPresentationSections(metadata,target)){
  const visible=section=>{if(!section.show)return false;let parent=section.parentId;while(parent){const ancestor=sections.find(value=>value.id===parent);if(!ancestor?.show)return false;parent=ancestor.parentId;}return true;};
  for(const section of sections){
   if(visible(section)&&['records','projects','media'].includes(section.kind))return all();
   // Link preparation currently includes hidden authored links. Match that
   // contract instead of silently changing their destination semantics.
   if(internal(section.href)||section.richText&&(linked(section.richText)||proseReferences(section.richText).length))return all();
  }
 }
 if(metadata.website.presentation.media.some(value=>internal(value.link)))return all();
 if(kind!=='notebook')return none();
 const local=metadata.notebooks.some(book=>book.id===id);
 return {includes:source=>!local&&(!source.labBookId||publicationOwnerId(metadata.id,source.workspaceId,'notebook',source.labBookId)===id)};
}
