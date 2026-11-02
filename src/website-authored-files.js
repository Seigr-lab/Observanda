import {MediaStore} from './media.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {projectPublication} from './publication-projection.js';
import {renderPublication} from './publication.js';
import {selectedContent} from './web/website-model.js';
import {AppError} from './errors.js';

// The saved site is authoritative for its authored pages. No research owner
// needs to be opened when its selection admits no entries.
export function authoredSiteOnly(site){
 const selection=site.selection;
 return selection?.defaultShare===false&&selection.includeProjects.length===0&&
  selection.records.every(record=>record.share!==true)&&!(site.document.website.researchSources?.length);
}
export async function renderAuthoredSite(workspace,metadata,{blockedValues=[],signal}={}){
 const book={...metadata,entries:[]};
 const context=projectPublication(book,selectedContent(book)),mediaFiles=new Map(),assets=new Map();
 for(const item of context.website.assets)assets.set(item.id,item.kind);
 for(const item of [context.website,...context.projects,...context.notebooks,...context.pages])
  for(const logo of item.logos)assets.set(logo.id,'image');
 const media=new MediaStore(workspace);
 for(const [id,kind] of assets){
  signal?.throwIfAborted();const file=await media.get(id,{streamed:true,signal});
  if(file.kind!==kind)throw new AppError('MEDIA_INVALID');mediaFiles.set(id,file);
 }
 const fontFiles=await new WorkspaceFonts(workspace).files(context,{signal});
 const result=renderPublication(context,{blockedValues,mediaFiles,fontFiles});
 result.files.delete('publication.json');return result.files;
}
