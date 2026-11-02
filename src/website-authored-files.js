import {MediaStore} from './media.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {projectPublication} from './publication-projection.js';
import {renderPublication} from './publication.js';
import {publicationPage} from './publication-page.js';
import {contentHash} from './file-content.js';
import {REGION_SLOTS,resolveRegion} from './web/website-regions.js';
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

// The editor owns these files in a separate encrypted directory. Derive each
// unpublished page from its saved composition. A research card or attachment
// can only come from the already-admitted edition, with its placement identity.
export async function renderDraftPages(workspace,metadata,publicFiles,{edition,bind,signal}={}){
 const pages=metadata.pages.filter(page=>!page.share),files=new Map();if(!pages.length)return files;
 const book={...metadata,entries:[],pages:metadata.pages.map(page=>({...page,share:true}))};
 if(edition){book.projects=await Array.fromAsync(edition.input.items('projects'));book.notebooks=await Array.fromAsync(edition.input.items('notebooks'));}
 const localMedia=new MediaStore(workspace),fonts=new WorkspaceFonts(workspace),styles=new Set();
 const cards=edition?Array.from(edition.records.values(),item=>item.card):[],projects=book.projects.filter(p=>p.share);
 const projectIds=new Set(projects.map(p=>p.id)),notebooks=book.notebooks.filter(n=>n.share!==false&&projectIds.has(n.projectId));
 const selected={...selectedContent(book),projects,notebooks,recordCards:cards};
 for(const page of pages){
  signal?.throwIfAborted();const target='page:'+page.id;
  const sections=[...page.sections,...(book.website.layouts.find(item=>item.target===target)?.sections??[]),...REGION_SLOTS.flatMap(slot=>resolveRegion(book.website,target,slot)?.sections??[])];
  const entries=[];
  if(edition)for(const id of new Set(sections.filter(s=>s.kind==='media').map(s=>s.entryId))){
   if(edition.records.has(id))entries.push(await edition.input.record(id));
  }
  const context=projectPublication(book,{...selected,entries},{publicationTarget:target,entryDestinations:cards}),plan=publicationPage(context,target),mediaFiles=new Map();
  for(const [id,kind] of plan.media){
   const extension={image:'png',audio:'wav',video:'mp4'}[kind],name='media/'+id+'.'+extension;
   const file=edition?.aliases.has(name)?{kind,extension,bytes:await edition.candidate.files.get(name)}:await localMedia.get(id,{streamed:true,signal});
   if(file.kind!==kind)throw new AppError('MEDIA_INVALID');mediaFiles.set(id,file);
  }
  const rendered=renderPublication(context,{mediaFiles,fontFiles:await fonts.files(plan.fonts,{signal}),emitBrowse:false});
  for(const [name,content] of rendered.files){
   if(name==='publication.json'||name==='.nojekyll'||edition?.aliases.has(name))continue;
   if(name==='styles.css'){for(const style of [rendered.styles.common,rendered.styles.fonts,rendered.styles.rich,...rendered.styles.blocks])if(style)styles.add(style);continue;}
   const value=name.endsWith('.html')?(bind?bind(name,content):content).replace(/(<link rel="stylesheet" href="(?:\.\.\/)*)styles\.css"/g,'$1draft-styles.css"'):content;
   const existing=publicFiles.get(name)??files.get(name);
   if(existing!==undefined){if(contentHash(existing)!==contentHash(value))throw new AppError('WEBSITE_CONVERSION_DEPENDENCIES',[{reason:'draft-file-collision'}]);}
   else files.set(name,value);
  }
 }
 let css=[...styles].join('\n');for(const [original,alias] of edition?.aliases??[])css=css.split(original).join(alias);
 files.set('draft-styles.css',css);return files;
}
