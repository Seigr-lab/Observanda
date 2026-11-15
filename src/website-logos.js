import {parse} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants} from './website-migration-views.js';
import {escapeWebsiteText as esc} from './website-file-html.js';
import {WebsiteEditorStore} from './website-editor-store.js';
import {MediaStore} from './media.js';
import {researchId} from './web/research-reference.js';
import {contentBuffer} from './file-content.js';
import {websiteHTMLByteLimit} from './website-file-policy.js';

// The logos chosen in a website's Branding reach the pages made in its website
// editor when they are previewed or published, never in the saved page: Branding
// changes on its own, so a saved copy would go stale. A Logos block names whose
// logos it shows; a page without one shows its own logos at the top of the page.
export const LOGOS_ATTRIBUTE='data-observanda-logos';
export const LOGOS_STYLESHEET='website-logos.css';
// Zero-specificity rules, so any style the author writes takes precedence.
export const LOGOS_CSS=':where(.site-logos){display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin:.75rem auto;padding:0 1rem;max-width:72rem}\n:where(.site-logos:empty){display:none}\n:where(.site-logos img){display:block;width:auto;height:auto;max-height:4rem;max-width:12rem}\n';
const LOGO_FILE=/^logos\/([a-f0-9-]{36})\.(png|jpe?g|webp|svg)$/;
export const logoFileId=name=>{const match=LOGO_FILE.exec(name);return match&&researchId(match[1])?match[1]:null;};
const targetPattern=/^(project|notebook|entry):([a-f0-9-]{36})$/;
export const validLogoScope=value=>value==='auto'||value==='home'||targetPattern.test(value??'')&&researchId(value.split(':')[1]);

// Whose logos a page shows automatically: the one record it presents, then that
// record's lab book and project, then the website itself.
function automaticChain(page,records){
 const ids=[...new Set(records.get(page.path)??[])];
 if(page.path==='index.html'||ids.length!==1)return ['home'];
 const record=ids[0],{notebookId,projectId}=records.owner(record)??{};
 return ['entry:'+record,...(notebookId?['notebook:'+notebookId]:[]),...(projectId?['project:'+projectId]:[]),'home'];
}

// A saved Branding choice wins, even an empty one; otherwise the same defaults
// the Branding page shows: the website logo for home and a project's own logo.
export function chosenLogos(chain,{override,fallback}){
 for(const target of chain){
  const saved=override(target);if(saved)return saved.logos;
  const defaults=fallback(target);if(defaults.length)return defaults;
 }
 return [];
}

// A page's own logos are pictures of the website kept in an inert template in
// the page, so they move, version and leave with the page. They come first in
// the page's automatic place; the template itself is never published.
export const PAGE_LOGOS_ATTRIBUTE='data-observanda-page-logos';
export const maxPageLogos=4;
function markers(html){
 const document=parse(html,{sourceCodeLocationInfo:true}),all=[...descendants(document)];
 const templates=all.filter(node=>node.tagName==='template'&&attr(node,PAGE_LOGOS_ATTRIBUTE)!==undefined);
 const own=templates.slice(0,1).flatMap(node=>[...descendants(node.content??{})]).filter(node=>node.tagName==='img'&&attr(node,'src')).slice(0,maxPageLogos).map(node=>({src:attr(node,'src'),alt:attr(node,'alt')??''}));
 return {document,templates,own,nodes:all.filter(node=>node.tagName&&attr(node,LOGOS_ATTRIBUTE)!==undefined)};
}

// Branding is kept with the research it presents; a website file store without
// research storage has no branding and so no logos.
async function hasBranding(workspace){
 try{return await workspace.storageKind()==='catalogue';}
 catch(error){if(['MISSING','ENOENT'].includes(error.code))return false;throw error;}
}
// The saved website document; the workspace's first website is addressed as its default.
async function brandingContext(editor,websiteId,{signal}={}){
 const registry=await editor.documents.registry();
 return editor.context(registry&&websiteId===registry.defaultSiteId?null:websiteId,{signal});
}
// One read of the website's saved branding and the research owners it needs.
async function readBranding(workspace,websiteId,targets,{signal}={}){
 const outline=(await workspace.outline()).metadata,projects=new Map(outline.projects.map(project=>[project.id,project]));
 const saved=new Map();let website=null;
 await workspace.catalogue(async catalogue=>{
  const editor=new WebsiteEditorStore(catalogue);let context;
  try{context=await brandingContext(editor,websiteId,{signal});}
  catch(error){if(['NOT_FOUND','ACCESS_UPGRADE'].includes(error.code))return;throw error;}
  website={logoId:(await context.document.field(['document','website','logoId'],{signal})).value,logoAlt:(await context.document.field(['document','website','logoAlt'],{signal})).value??''};
  for(const target of targets){signal?.throwIfAborted();const row=await editor.sourceItem(context,'branding',target,{signal});if(row)saved.set(target,row.value);}
 });
 return {
  override:target=>saved.get(target)??null,
  fallback:target=>{
   if(target==='home')return website?.logoId?[{id:website.logoId,alt:website.logoAlt}]:[];
   const match=targetPattern.exec(target),project=match?.[1]==='project'?projects.get(match[2]):null;
   return project?.logoId?[{id:project.logoId,alt:project.title}]:[];
  }
 };
}

// The records each page presents and the lab book and project of each record.
async function presentedRecords(store,workspace,manifest,pages,{signal}={}){
 const byPage=new Map(),wanted=new Set();
 for(const page of pages){
  if(page.path==='index.html')continue;const records=[];
  for(const placement of page.placements??[]){
   signal?.throwIfAborted();const source=await store.source(placement.id);
   if(source?.target==='website'&&source.provenance?.recordId)records.push(source.provenance.recordId);
  }
  byPage.set(page.path,records);if(new Set(records).size===1)wanted.add(records[0]);
 }
 const owners=new Map();
 if(wanted.size)await workspace.catalogue(async catalogue=>{
  const snapshot=await catalogue.snapshot(),notebooks=new Map(snapshot.metadata.notebooks.map(book=>[book.id,book]));
  for(const id of wanted){
   signal?.throwIfAborted();const row=await catalogue.member(snapshot,id),notebook=row?.notebookId?notebooks.get(row.notebookId):null;
   if(notebook)owners.set(id,{notebookId:notebook.id,projectId:notebook.projectId});
  }
 });
 return {get:path=>byPage.get(path),owner:id=>owners.get(id)};
}

// Plans every given page: the logos of its automatic place and of each Logos
// block it holds, and the image file each logo is published as.
export async function websiteLogoPlan(store,manifest,entries,{signal}={}){
 const pages=new Map(manifest.pages.map(page=>[page.path,page])),hosts=new Map((manifest.feeds??[]).map(feed=>[feed.id,feed.path]));
 const planned=[],targets=new Set();
 for(const {name,html,feedPage} of entries){
  const page=pages.get(feedPage?hosts.get(feedPage):name);if(!page)continue;
  const scopes=[...new Set(markers(html).nodes.map(node=>attr(node,LOGOS_ATTRIBUTE)).filter(validLogoScope))];
  planned.push({name,html,page,scopes});
 }
 if(!planned.length)return {pages:new Map(),files:new Map()};
 // Without research storage there is no Branding, but a page's own logos remain.
 const files=new Map(),names=new Map(),result=new Map();
 if(!await hasBranding(store.workspace)){
  for(const row of planned)result.set(row.name,{logos:{auto:[]},names});
  return {pages:result,files};
 }
 const records=await presentedRecords(store,store.workspace,manifest,[...new Set(planned.map(row=>row.page))],{signal});
 const chains=new Map();
 for(const row of planned){
  row.chain=automaticChain(row.page,records);for(const target of row.chain)targets.add(target);
  for(const scope of row.scopes)if(scope!=='auto')targets.add(scope);
 }
 const branding=await readBranding(store.workspace,manifest.id,targets,{signal});
 const media=new MediaStore(store.workspace);
 const logosOf=chain=>{const key=chain.join(' ');if(!chains.has(key))chains.set(key,chosenLogos(chain,branding));return chains.get(key);};
 for(const row of planned){
  const logos={auto:logosOf(row.chain)};for(const scope of row.scopes)if(scope!=='auto')logos[scope]=logosOf([scope]);
  for(const list of Object.values(logos))for(const logo of list){
   if(names.has(logo.id))continue;signal?.throwIfAborted();
   let file;try{file=await media.get(logo.id,{streamed:true,signal});}catch(error){if(['NOT_FOUND','MEDIA_MISSING','ENOENT'].includes(error.code)){names.set(logo.id,null);continue;}throw error;}
   if(file.kind!=='image')throw new AppError('MEDIA_INVALID');
   const name='logos/'+logo.id+'.'+file.extension;names.set(logo.id,name);files.set(name,file.bytes);
  }
  result.set(row.name,{logos,names});
 }
 return {pages:result,files};
}

// Fills each Logos block, or adds the automatic one at the top of the page,
// keeping every authored byte around them.
export function applyPageLogos(html,file,{logos,names}){
 const {document,nodes,templates,own}=markers(html),prefix='../'.repeat(file.split('/').length-1);
 const used=new Set(),images=list=>list.filter(logo=>names.get(logo.id)).map(logo=>{used.add(names.get(logo.id));return '<img src="'+esc(prefix+names.get(logo.id))+'" alt="'+esc(logo.alt)+'">';}).join('');
 // The page's own pictures are already written relative to the page.
 const ownMarkup=own.map(logo=>'<img src="'+esc(logo.src)+'" alt="'+esc(logo.alt)+'">').join('');
 const automatic=()=>ownMarkup||images(logos.auto??[]);
 const edits=templates.flatMap(node=>node.sourceCodeLocation?[[node.sourceCodeLocation.startOffset,node.sourceCodeLocation.endOffset,'']]:[]);let shown=false;
 for(const node of nodes){
  const location=node.sourceCodeLocation,scope=attr(node,LOGOS_ATTRIBUTE);if(!location?.startTag||!location.endTag)continue;
  const markup=scope==='auto'?automatic():validLogoScope(scope)?images(logos[scope]??[]):'';if(markup)shown=true;
  edits.push([location.startTag.endOffset,location.endTag.startOffset,markup]);
 }
 const body=[...descendants(document)].find(node=>node.tagName==='body');
 if(!nodes.length&&body?.sourceCodeLocation?.startTag){
  const markup=automatic();
  if(markup){
   const first=(body.childNodes??[]).find(node=>node.tagName),skip=first?.tagName==='a'&&(attr(first,'href')??'').startsWith('#');
   const at=skip?first.sourceCodeLocation.endOffset:body.sourceCodeLocation.startTag.endOffset;
   edits.push([at,at,'<div class="site-logos" '+LOGOS_ATTRIBUTE+'="auto">'+markup+'</div>']);shown=true;
  }
 }
 if(!shown)return {html:edits.length?splice(html,edits):html,shown,used};
 const head=[...descendants(document)].find(node=>node.tagName==='head')?.sourceCodeLocation?.endTag;
 if(head)edits.push([head.startOffset,head.startOffset,'<link rel="stylesheet" href="'+esc(prefix+LOGOS_STYLESHEET)+'">']);
 return {html:splice(html,edits),shown,used};
}
// Gives a set of output files their logos: pages are rewritten and the logo
// images and their stylesheet added. Names an author already uses are kept.
export async function applyWebsiteLogos(store,manifest,files,descriptors,{signal}={}){
 const entries=[];
 for(const [name,content] of files){
  if(!name.endsWith('.html'))continue;signal?.throwIfAborted();
  entries.push({name,feedPage:descriptors.get(name)?.feedPage,html:(await contentBuffer(content,{signal,maxBytes:websiteHTMLByteLimit})).toString('utf8')});
 }
 const plan=await websiteLogoPlan(store,manifest,entries,{signal}),used=new Set();let shown=false;
 for(const entry of entries){
  const row=plan.pages.get(entry.name);if(!row)continue;
  const output=applyPageLogos(entry.html,entry.name,row);if(output.html===entry.html)continue;
  files.set(entry.name,Buffer.from(output.html));for(const name of output.used)used.add(name);shown||=output.shown;
 }
 if(!shown)return [];
 const added=[...used,LOGOS_STYLESHEET];
 if(added.some(name=>files.has(name)||descriptors.has(name)))throw new AppError('CONFLICT');
 for(const name of used)files.set(name,plan.files.get(name));
 files.set(LOGOS_STYLESHEET,Buffer.from(LOGOS_CSS));
 return added;
}
// A logo image is served only while it is one of this website's branding logos.
export async function websiteLogoFile(store,manifest,name,{signal}={}){
 const id=logoFileId(name);if(!id||!await hasBranding(store.workspace))return null;
 const outline=(await store.workspace.outline()).metadata;let known=outline.projects.some(project=>project.logoId===id);
 if(!known)await store.workspace.catalogue(async catalogue=>{
  const editor=new WebsiteEditorStore(catalogue);let context;
  try{context=await brandingContext(editor,manifest.id,{signal});}catch(error){if(['NOT_FOUND','ACCESS_UPGRADE'].includes(error.code))return;throw error;}
  if((await context.document.field(['document','website','logoId'],{signal})).value===id){known=true;return;}
  for await(const item of context.document.items(['document','branding'],{signal})){
   signal?.throwIfAborted();const value=await context.document.tree.read(item.value);
   if(value.logos.some(logo=>logo.id===id)){known=true;return;}
  }
 });
 if(!known)return null;
 const file=await new MediaStore(store.workspace).get(id,{streamed:true,signal});
 if(file.kind!=='image'||name!=='logos/'+id+'.'+file.extension)return null;
 return {content:file.bytes,contentType:file.mime};
}
function splice(html,edits){
 let output=html;
 for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]||b[1]-a[1]))output=output.slice(0,start)+text+output.slice(end);
 return output;
}
