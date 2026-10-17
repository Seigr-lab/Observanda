import {withPublicationMetadataReader} from './publication-metadata-reader.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {openPublicationInput} from './publication-input-reader.js';
import {publicationInputPlan,publicationInputContext} from './publication-edition-projection.js';
import {publicationInputCollectionWindows} from './publication-collection-pages.js';
import {publicationIndexPage} from './publication-browse-pages.js';
import {publicationBrowse} from './publication-browse.js';
import {PUBLIC_INDEX_ROWS} from './web/public-browse-pages.js';
import {readingJourney} from './web/book-journeys.js';
import {publicationEditionParts} from './publication-edition-fragments.js';
import {publicationPage} from './publication-page.js';
import {renderPublication,escapeHTML} from './publication.js';
import {publicationInputMedia} from './publication-input-media.js';
import {WorkspaceFonts} from './workspace-fonts.js';

const browseRow=({id,title,notebookId,type,journey,tags,occurredOn})=>({id,title,notebookId,type,journey:readingJourney({journey,type}),tags:[...tags],occurredOn:structuredClone(occurredOn)});
async function* browsePages(input,{signal}){
 const total=await input.recordCount({historical:false}),hash=createHash('sha256');
 for await(const value of input.records({historical:false,order:'original'})){signal?.throwIfAborted();hash.update(JSON.stringify(browseRow(value))+'\n');}
 const identity=hash.digest('hex');let rows=[],page=0;
 for await(const value of input.records({historical:false,order:'original'})){
  signal?.throwIfAborted();rows.push(browseRow(value));
  if(rows.length===PUBLIC_INDEX_ROWS){yield {rows,...(total<=PUBLIC_INDEX_ROWS?{path:'browse.html',content:publicationBrowse(rows,escapeHTML)}:publicationIndexPage(rows,{identity,page,total},escapeHTML))};rows=[];page++;}
 }
 if(rows.length)yield {rows,...(total<=PUBLIC_INDEX_ROWS?{path:'browse.html',content:publicationBrowse(rows,escapeHTML)}:publicationIndexPage(rows,{identity,page,total},escapeHTML))};
}
async function* references(input,target,{signal}){
 if(!target.startsWith('entry:')){yield null;return;}
 let offset=0;
 do{signal?.throwIfAborted();const window=await input.references(target.slice(6),{offset,limit:24});yield {...window,page:offset/24};offset+=window.rows.length;if(!window.next)return;if(!window.rows.length)throw new AppError('JOB_DAMAGED');}while(true);
}
export function buildIndexedPublicationEdition(workspace,source,options={}){
 return withPublicationMetadataReader(workspace,reader=>renderIndexedPublicationEdition(reader,source,options),{signal:options.signal});
}
async function renderIndexedPublicationEdition(workspace,source,{writer,blockedValues=[],signal,progress=async()=>{}}={}){
 if(!writer)throw new AppError('INVALID');signal??=new AbortController().signal;
 const input=await openPublicationInput(workspace,source,{signal}),media=publicationInputMedia(workspace,source),fonts=new WorkspaceFonts(workspace);
 let commonStyles=null,defaultPage=null,completed=0,firstPlan=null;const total=await input.count('targets');
 const retainStyles=async styles=>{
  if(commonStyles!==null&&commonStyles!==styles.common)throw new AppError('JOB_DAMAGED');commonStyles=styles.common;
  for(const [kind,values] of [['fonts',styles.fonts.split('\n')],['rich',styles.rich.split('\n')],['blocks',styles.blocks]])for(const css of values)if(css)await writer.addChoice('styles',digest(kind+'\n'+css),{kind,css});
 };
 const render=async(plan,{bodyWindow=null,referenceWindow=null,browse=null,legacy=null}={})=>{
  signal.throwIfAborted();const {context}=await publicationInputContext(input,plan,{bodyWindow,referenceWindow,browsePage:browse,signal}),prepared=publicationPage(context,plan.target),mediaFiles=new Map();
  for(const [id,kind] of prepared.media){const file=await media.get(id,{streamed:true});if(file.kind!==kind)throw new AppError('MEDIA_INVALID');mediaFiles.set(id,file);}
  if(legacy)context.legacyPages=[legacy];
  const fontFiles=await fonts.files(prepared.fonts,{signal}),parts=await publicationEditionParts(input,plan,{writer,media,mediaFiles,context,esc:escapeHTML,blockedValues,signal,browse}),page=renderPublication(context,{blockedValues,mediaFiles,fontFiles,emitBrowse:false,editionParts:parts});parts.attach(page);await retainStyles(page.styles);
  for(const [name,content] of [...page.files])if(!['styles.css','publication.json','.nojekyll'].includes(name)&&!name.endsWith('.html')){await writer.retain(name,content);page.files.delete(name);}
  for(const [name,html] of page.files){
   if(!name.endsWith('.html')||legacy&&name!==legacy.path)continue;
   await writer.retain(name,parts.fragments.expand(html));if(!referenceWindow?.next)await parts.continuations(name,html);
  }
  for(const value of page.pages){
   if(legacy&&value.path!==legacy.path||browse&&value.path!=='browse.html')continue;
   // Body and reference continuation pages are not additional page choices.
   if(bodyWindow?.staticPage.page||referenceWindow?.page)continue;
   await writer.addChoice('pages',value.path,value);defaultPage??=value.path;
  }
 };
 for await(const item of input.items('targets')){
  signal.throwIfAborted();const target=item.target,plan=await publicationInputPlan(input,target,{signal});firstPlan??=plan;
  for await(const bodyWindow of publicationInputCollectionWindows(input,target,{replace:plan.layout?.placement==='replace',signal}))for await(const referenceWindow of references(input,target,{signal}))await render(plan,{bodyWindow,referenceWindow});
  if(target.startsWith('entry:'))await writer.addChoice('entries',target.slice(6),{id:target.slice(6),title:item.title});
  if(target.startsWith('project:'))await writer.addChoice('projects',target.slice(8),{id:target.slice(8),title:item.title});
  await progress({stage:'Building selected pages',done:++completed,total});
 }
 if(firstPlan)for await(const legacy of input.items('legacyPages'))await render(firstPlan,{legacy});
 if(await input.recordCount({historical:false})){
  const plan=await publicationInputPlan(input,'browse',{signal});for await(const browse of browsePages(input,{signal}))await render(plan,{browse});
 }
 await writer.retain('styles.css',(async function*(){yield commonStyles??'';for(const kind of ['fonts','rich','blocks'])for await(const style of writer.choices('styles'))if(style.kind===kind)yield '\n'+style.css;})());
 await writer.retain('.nojekyll','');return {defaultPage};
}
