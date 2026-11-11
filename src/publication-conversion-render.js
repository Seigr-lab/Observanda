import {parse,serializeOuter} from 'parse5';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNotebook} from './model.js';
import {AppError} from './errors.js';
import {projectPublication} from './publication-projection.js';
import {publicationPage} from './publication-page.js';
import {renderPublication,escapeHTML} from './publication.js';
import {retainedArticleCSS} from './website-entry-styles.js';
import {sourcePublicationRecord,sourceRecordAllowed} from './web/source-publication-permissions.js';
import {publicationPartAllowed} from './web/record-publication-privacy.js';
import {proseDocument} from './web/prose-model.js';
import {validFigure} from './web/figure-model.js';
import {MediaStore} from './media.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {FileContent,contentHash} from './file-content.js';
import {PublicationFragments} from './publication-edition-fragments.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {RetainedFigureAuthoring} from './retained-figure-authoring.js';
import {renderApprovedFigureContents} from './publication-figure-renderer.js';
import {hasRetainedFigure} from './record-retained-figures.js';
import {retainedFigureTargets} from './retained-figure-targets.js';
import {ResearchMaterials} from './research-materials.js';
import {retainedTableHTML} from './publication-retained-tables.js';
import {addPhotoRenditions} from './website-image-renditions.js';
import {figureVariantKey,figureVariantLanguages,mapFigureVariants} from './website-figure-variants.js';

const attr=(node,name)=>node.attrs?.find(value=>value.name===name)?.value;
const classes=node=>(attr(node,'class')??'').split(/\s+/);
function* nodes(node){yield node;for(const child of node.childNodes??[])yield* nodes(child);}
const mime=name=>({png:'image/png',svg:'image/svg+xml',mp4:'video/mp4',wav:'audio/wav',woff2:'font/woff2',woff:'font/woff',ttf:'font/ttf',otf:'font/otf',txt:'text/plain'})[name.split('.').at(-1)]??'application/octet-stream';
const text=async iterable=>{let value='';for await(const chunk of iterable)value+=Buffer.isBuffer(chunk)?chunk.toString('utf8'):chunk;return value;};
const bytes=async iterable=>{const chunks=[];for await(const chunk of iterable)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks);};

// Each copied component has a stable identity. Privacy updates can remove a
// nested inline image without replacing its surrounding authored paragraph.
export function annotatePublicationParts(article,record){
 const attachments=new Set(record.attachments.map(item=>item.id));
 const set=(node,key)=>{if(!node.attrs)throw new AppError('INVALID');const prior=node.attrs.find(item=>item.name==='data-observanda-part');if(prior)prior.value=key;else node.attrs.push({name:'data-observanda-part',value:key});};
 for(const node of nodes(article)){
  const id=attr(node,'id');
  if(id?.startsWith('record-section-'))set(node,'section:'+id.slice(15));
  if(id?.startsWith('record-figure-')){const figure=id.slice(14);set(node,(attachments.has(figure)?'media:':'figure:')+figure);}
 }
 let other=0;
 for(const child of article.childNodes??[]){
  if(!child.tagName||attr(child,'data-observanda-part'))continue;
  const names=classes(child);
  const key=names.includes('entry-meta')?'metadata':names.includes('record-contributors')?'contributors':names.includes('rich-document')?'body':names.includes('record-related')?'relations':names.includes('tags')?'tags':names.includes('attempt-history')||names.includes('record-attempt')?'attempt':names.some(name=>/result/.test(name))?'results':child.tagName==='p'&&child.childNodes?.[0]?.tagName==='strong'?'outcome':'supplement-'+other++;
  set(child,key);
 }
 return article;
}

// The website copy has its title as an h2 before the article. Every heading
// inside the article moves one level down, so the record's sections, results
// and related research form an outline under that title. h6 stays h6.
// Wide result and data tables keep their natural column widths and scroll
// inside their focusable region instead of squeezing every column.
export const websiteRecordRules='.book-table-scroll>table{table-layout:auto;width:max-content;min-width:100%}.book-table-scroll :is(td,th){overflow-wrap:break-word}'+
 ':is(.book-table-scroll,.table-scroll):focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}';
export function nestRecordHeadings(article){
 for(const node of nodes(article)){
  const level=/^h([1-5])$/.exec(node.tagName)?.[1];
  if(level)node.tagName=node.nodeName='h'+(Number(level)+1);
 }
 return article;
}

// Called only by an explicit publication-visibility operation while its exact
// research owner is available. The returned HTML and assets have no source I/O.
export async function convertPublicationRecord(storage,metadata,original,{signal,target:channel='website'}={}){
 if(!sourceRecordAllowed(original,metadata,channel))return {visible:false,html:'',css:'',assets:[]};
 signal?.throwIfAborted();
 const hidden=new Set(original.publication?.[channel]?.hiddenFigures),retainedTargets=new Set();
 if(hidden.size&&publicationPartAllowed(original,'figures',channel)&&publicationPartAllowed(original,'results',channel)){
  const needed=new Set((original.results?.statements??[]).filter(item=>item.kind==='figure').map(item=>item.figureId));
  for(const figure of original.figures??[]){
   if(!needed.size)break;
   if(figure.kind!=='retained'||hidden.has(figure.id))continue;
   for await(const target of retainedFigureTargets(storage,figure,{signal})){if(needed.delete(target.id))retainedTargets.add(target.id);if(!needed.size)break;}
  }
 }
 const selected=sourcePublicationRecord(original,channel,retainedTargets),record={...selected,share:true,sections:selected.sections.map(item=>({...item,share:true})),attachments:selected.attachments.map(item=>({...item,share:true}))};
 const notebook=metadata.notebooks.find(item=>item.id===record.notebookId),project=metadata.projects.find(item=>item.id===notebook.projectId);
 if(!project)throw new AppError('CATALOGUE_DAMAGED');
 // Build only the selected entry's composition. No other owner's names,
 // navigation, homepage, records, or publication choices are visited.
 const book=createNotebook(record.title);book.id=metadata.id;
 book.projects=[{id:project.id,title:project.title,description:'',share:true,logoId:null}];
 book.notebooks=[{id:notebook.id,projectId:project.id,title:notebook.title,share:true}];book.entries=[record];book.website.design.navigation='none';book.website.design.contents=false;
 const target='entry:'+record.id,selection={projects:book.projects,notebooks:book.notebooks,entries:[record],pages:[],homeEnabled:false};
 const context=projectPublication(book,selection,{publicationTarget:target,entryDestinations:[record]}),plan=publicationPage(context,target),mediaFiles=new Map(),media=plan.media.size?new MediaStore(storage):null;
 for(const [id,kind] of plan.media){signal?.throwIfAborted();const asset=await media.get(id,{streamed:true,signal,headerBytes:kind==='image'&&channel==='website'?24:12});if(asset.kind!==kind)throw new AppError('MEDIA_INVALID');mediaFiles.set(id,asset);}
 const fontFiles=await new WorkspaceFonts(storage).files(plan.fonts,{signal}),fragments=new PublicationFragments(),retainedAssets=new Map(),tables=new Map(),figures=new Map();
 for(const figure of record.figures){
  if(!hasRetainedFigure(figure))continue;signal?.throwIfAborted();
  // Normalise a mixed panel composition using the same retained authoring
  // contract as publication capture; immutable blocks remain in its owner.
  let retained=figure;
  if(figure.kind!=='retained'){const author=new RetainedFigureAuthoring(storage,{signal});retained=await author.finish(await author.start(figure));}
  const reader=await new RetainedFigureDocuments(storage,{readOnly:true,signal}).open(retained);
  const writer={retain:async(name,chunks)=>retainedAssets.set(name,await bytes(chunks))};
  figures.set(figure.id,await text(renderApprovedFigureContents(reader,record.id,figure,{writer,results:context.entries[0].results,signal,languages:channel==='website'?figureVariantLanguages:[]})));
 }
 let materials;
 for(const statement of record.results?.statements??[])if(statement.table?.version===3){materials??=new ResearchMaterials(storage);tables.set(statement.id,fragments.add(()=>retainedTableHTML(materials,statement,{signal})));}
 const editionParts={navigation:()=>'',retainedFigure:(_recordId,id)=>{if(!figures.has(id))throw new AppError('MATERIAL_MISSING');return figures.get(id);},retainedTable:(_recordId,id)=>{if(!tables.has(id))throw new AppError('MATERIAL_MISSING');return tables.get(id);}};
 const candidate=renderPublication(context,{mediaFiles,fontFiles,editionParts,emitBrowse:false,figureLanguages:channel==='website'?figureVariantLanguages:null}),html=await text(fragments.expand(candidate.files.get('entries/'+record.id+'.html'))),document=parse(html);
 const article=[...nodes(document)].find(node=>node.tagName==='article'&&classes(node).includes('record-page'));if(!article)throw new AppError('INVALID');
 annotatePublicationParts(article,record);
 if(channel==='website')nestRecordHeadings(article);
 const assetPaths=new Map(),assets=[];
 for(const [name,value] of [...candidate.files,...retainedAssets]){
  if(!/^(media|figures|fonts)\//.test(name))continue;signal?.throwIfAborted();
  const content=typeof value==='string'?Buffer.from(value):value,hash=content instanceof FileContent?contentHash(content):createHash('sha256').update(content).digest('hex'),extension=path.posix.extname(name).slice(1).toLowerCase();
  if(!/^[a-z0-9]+$/.test(extension))throw new AppError('INVALID');
  const destination='assets/'+hash+'.'+extension;assetPaths.set(name,destination);if(!assets.some(asset=>asset.path===destination))assets.push({path:destination,...(content instanceof FileContent?{content}:{bytes:content}),contentType:mime(name)});
 }
 for(const node of nodes(article))for(const value of node.attrs??[])if(value.name===figureVariantKey)value.value=mapFigureVariants(value.value,url=>{
  const replacement=assetPaths.get(path.posix.normalize(path.posix.join('entries',url)));if(!replacement)throw new AppError('MEDIA_MISSING');return replacement;
 });
 for(const node of nodes(article))for(const value of node.attrs??[])if(['src','href','poster'].includes(value.name)&&!value.value.startsWith('#')&&!/^[a-z][a-z0-9+.-]*:/i.test(value.value)){
  const name=path.posix.normalize(path.posix.join('entries',value.value)),replacement=assetPaths.get(name);
  if(replacement)value.value=replacement;
  else if(value.name==='href'){value.value='#';}
  else throw new AppError('MEDIA_MISSING');
 }
 // Restrict the renderer's composition styles to copied fragments. Its sample
 // page header, body typography and root variables must not restyle the website.
 // The block rules stay last: a record's own footer rule is recognised there.
 // On a website the copy's renderer styles form one cascade layer: any rule of
 // the site itself (its stylesheet, theme, style book or tokens) wins over
 // them, and they only fill in what the site does not style.
 const scoped='@scope ([data-observanda-source]) {\n'+[candidate.styles.common,...(channel==='website'?[websiteRecordRules]:[]),candidate.styles.rich,...candidate.styles.blocks].join('\n')+'\n}';
 let css=candidate.styles.fonts+'\n'+(channel==='website'?'@layer observanda-record {\n'+scoped+'\n}':scoped);for(const [name,replacement] of assetPaths)css=css.split(name).join(replacement);
 const title='<section data-observanda-part="title"><h2>'+escapeHTML(record.title)+'</h2></section>';
 if(channel==='website')await addPhotoRenditions(article,assets,signal);
 const fragment=title+serializeOuter(article);
 const output={visible:true,html:fragment,css:retainedArticleCSS(css,record.id,fragment),assets};
 if(channel==='pdf'){
  const page=context.entries[0],figures=page.figures.filter(figure=>!hasRetainedFigure(figure)&&validFigure(figure)),allowed=new Set(figures.map(figure=>figure.id));
  const images=page.attachments.filter(item=>item.kind==='image').map(item=>({id:item.id,path:assetPaths.get('media/'+item.id+'.png'),label:item.alt||item.caption||''}));
  // A retained plot is an owned SVG, never a pointer to private research blocks.
  for(const figure of page.figures)if(hasRetainedFigure(figure))images.push({id:figure.id,path:assetPaths.get('figures/'+record.id+'-'+figure.id+'.svg'),label:typeof figure.title==='string'?figure.title:figure.title.preview});
  const clean=node=>node.type==='book_figure'&&!allowed.has(node.attrs.figureId)?null:{...node,...(node.content?{content:node.content.map(clean).filter(Boolean)}:{})};
  const prose=value=>{if(typeof value==='string')return value;const result=clean(value);return result.content.length?result:'';};
  const body=publicationPartAllowed(original,'body','pdf')?prose(page.body):null,sections=page.sections.filter(item=>record.sections.some(section=>section.id===item.id)).map(item=>({id:item.id,title:item.title,content:prose(item.body)}));
  const blocks=body===null?[]:[...proseDocument(body).content];
  for(const section of sections)blocks.push({type:'heading',attrs:{level:2},content:[{type:'text',text:section.title}]},...proseDocument(section.content).content);
  const used=new Set();function visit(node){if(node.type==='book_figure')used.add(node.attrs.figureId);for(const child of node.content??[])visit(child);}blocks.forEach(visit);
  for(const figure of figures)if(!used.has(figure.id))blocks.push({type:'book_figure',attrs:{version:1,id:figure.id,figureId:figure.id,alternative:figure.title}});
  output.pdfParts={version:1,body,sections,figures,images,entry:{type:'doc',content:blocks.length?blocks:proseDocument('').content}};
 }
 return output;
}
