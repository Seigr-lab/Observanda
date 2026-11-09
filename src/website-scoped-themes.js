import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {parse,serialize} from 'parse5';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {validAppearance,scopedAppearanceCSS} from './web/website-appearance-model.js';
import {attr,descendants} from './website-migration-views.js';
import {digest} from './storage-format.js';
import {websiteFeedPages} from './website-dynamic-feeds.js';

const themeAttr='data-website-theme',pageAttr='data-website-page-theme',sheetAttr='data-website-theme-sheet';
const sheet=id=>'website-themes/'+id+'.css';
const empty=()=>({items:[],pages:{},folders:{}});
const invalid=()=>{throw new AppError('INVALID');};
const validLabel=s=>typeof s==='string'&&s.trim().length&&s.length<=160;
export function validateWebsiteThemes(manifest){
 const book=manifest.themeBook;if(book===undefined)return;
 if(!book||!Array.isArray(book.items)||!book.pages||!book.folders)throw new AppError('FORMAT');
 const ids=new Set(),sheets=new Set();
 for(const theme of book.items){
  if(!theme||!researchId(theme.id)||ids.has(theme.id)||!validLabel(theme.name)||!validAppearance(theme.values))throw new AppError('FORMAT');
  ids.add(theme.id);sheets.add(sheet(theme.id));
 }
 for(const entries of [book.pages,book.folders])if(typeof entries!=='object'||Array.isArray(entries)||Object.values(entries).some(id=>!ids.has(id)))throw new AppError('FORMAT');
 for(const file of manifest.files)if(file.themeSheet&&!sheets.has(file.name))throw new AppError('FORMAT');
}
function put(node,key,value){
 node.attrs=node.attrs.filter(a=>a.name!==key);if(value)node.attrs.push({name:key,value});
}
function tag(html,node,key,value){
 const loc=node?.sourceCodeLocation;
 if(!loc?.startTag)invalid();
 const old=loc.attrs?.[key],at=old?.startOffset??loc.startTag.endOffset-1;
 return html.slice(0,at)+(value?(old?'':' ')+key+'="'+value+'"':'')+html.slice(old?.endOffset??at);
}
export function sectionNode(doc,address){
 if(typeof address!=='string'||address.length>255||!/^\d{1,5}(?:\/\d{1,5})*$/.test(address))invalid();
 let node=[...descendants(doc)].find(n=>n.tagName==='body');
 for(const index of address.split('/'))node=node?.childNodes?.filter(n=>n.tagName)[Number(index)];
 if(!node?.tagName||!node.sourceCodeLocation?.startTag)invalid();
 for(let parent=node;parent;parent=parent.parentNode)if(parent.attrs?.some(a=>['data-observanda-source','data-observanda-link','data-observanda-part','data-website-instance','data-website-feed','data-website-source-gallery','data-observanda-editor','data-website-menu'].includes(a.name)))invalid();
 return node;
}
const directoryFor=owner=>{const dir=path.posix.dirname(owner);return dir==='.'?'':dir+'/';};
function inherited(book,owner){
 if(Object.hasOwn(book.pages,owner))return book.pages[owner];
 for(let dir=directoryFor(owner);dir;dir=directoryFor(dir.slice(0,-1)))if(Object.hasOwn(book.folders,dir))return book.folders[dir];
 return null;
}
function themePage(html,file,pageTheme,book){
 const doc=parse(html),nodes=[...descendants(doc)],ids=new Set(book.items.map(t=>t.id)),used=new Set();
 const body=nodes.find(n=>n.tagName==='body'),head=nodes.find(n=>n.tagName==='head');
 if(!body||!head)invalid();
 const previouslyUsed=new Set(file.usedThemes),ownsPageMarker=!!pageTheme||!!file.pageTheme;
 let changed=ownsPageMarker&&attr(body,pageAttr)!==(pageTheme??undefined);
 if(ownsPageMarker)put(body,pageAttr,pageTheme);
 if(pageTheme)used.add(pageTheme);
 for(const node of nodes){
  const id=attr(node,themeAttr);if(id===undefined)continue;
  if(ids.has(id))used.add(id);else if(previouslyUsed.has(id)){put(node,themeAttr,null);changed=true;}
 }
 const existing=nodes.filter(n=>n.tagName==='link'&&(ids.has(attr(n,sheetAttr))||previouslyUsed.has(attr(n,sheetAttr))));
 const ordered=[...used].sort(),href=id=>path.posix.relative(path.posix.dirname(file.name),sheet(id));
 const consistent=existing.length===ordered.length&&existing.every((n,i)=>attr(n,sheetAttr)===ordered[i]&&attr(n,'href')===href(ordered[i])&&attr(n,'rel')==='stylesheet'&&n.parentNode===head&&head.childNodes.indexOf(n)>head.childNodes.findLastIndex(c=>c.tagName==='style'||c.tagName==='link'&&attr(c,sheetAttr)===undefined&&attr(c,'rel')==='stylesheet'));
 if(!consistent){
  for(const n of existing)n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n),1);
  for(const id of ordered)head.childNodes.push({nodeName:'link',tagName:'link',namespaceURI:head.namespaceURI,parentNode:head,childNodes:[],attrs:[{name:'rel',value:'stylesheet'},{name:'href',value:href(id)},{name:sheetAttr,value:id}]});
 }
 return {html:changed||!consistent?serialize(doc):html,used:ordered};
}
export async function syncWebsiteThemes(store,manifest,signal){
 const book=manifest.themeBook;if(!book)return manifest;
 const owners=new Map(websiteFeedPages(manifest).map(f=>[f.path,f.ownerPage])),ids=new Set(book.items.map(t=>t.id)),usage=new Map(),files=[];
 const priorSheets=new Map(manifest.files.filter(f=>f.themeSheet).map(f=>[f.name,f]));
 for(const file of manifest.files){
  signal?.throwIfAborted();if(file.themeSheet)continue;
  if(!file.name.endsWith('.html')){files.push(file);continue;}
  const active=inherited(book,owners.get(file.name)??file.name);
  if(!active&&!file.themeSeal&&!file.hasWebsiteThemes){files.push(file);continue;}
  let next=file;
  if(file.themeSeal!==file.sha256||file.pageTheme!==active||!Array.isArray(file.usedThemes)||file.usedThemes.some(id=>!ids.has(id))){
   const html=await store.readText(file,{signal}),updated=themePage(html,file,active,book);
   next=updated.html===html?{...file}:{...file,...await store.siteFile(manifest.id,file.name,updated.html,{draft:file.draft,signal})};
   next.themeSeal=next.sha256;next.pageTheme=active;next.usedThemes=updated.used;
  }
  files.push(next);
  for(const id of next.usedThemes)usage.set(id,usage.get(id)==='public'||!file.draft?'public':'draft');
 }
 const names=new Set(files.map(f=>f.name));
 for(const theme of book.items){
  const visibility=usage.get(theme.id);if(!visibility)continue;
  const name=sheet(theme.id);if(names.has(name))throw new AppError('CONFLICT');
  const css=scopedAppearanceCSS(theme.id,theme.values),draft=visibility==='draft',old=priorSheets.get(name);
  files.push(old?.sha256===digest(css)&&Boolean(old.draft)===draft?old:{...await store.siteFile(manifest.id,name,css,{signal,draft}),themeSheet:true});
 }
 const next={...manifest,files};
 if(!book.items.length)delete next.themeBook;
 return next;
}
export async function websiteThemes(store,id,options,write){
 const {expectedRevision,path:page,action,themeId,values,name,scope,blockPath,signal}=options;
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??''))invalid();
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision),file=manifest.files.find(f=>f.name===page&&f.name.endsWith('.html')&&!f.feedPage);
  if(!file)throw new AppError('NOT_FOUND');
  const book=structuredClone(manifest.themeBook??empty()),folder=directoryFor(page);
  if(!write){
   let section=null;
   if(blockPath!=null){try{section=attr(sectionNode(parse(await store.readText(file,{signal}),{sourceCodeLocationInfo:true}),blockPath),themeAttr)??'';}catch(error){if(error.code!=='INVALID')throw error;}}
   const uses=new Map();for(const f of manifest.files)for(const id of f.usedThemes??[])uses.set(id,(uses.get(id)??0)+1);
   return {items:book.items.map(t=>({...t,uses:uses.get(t.id)??0})),folder,pageTheme:book.pages[page]??'',folderTheme:book.folders[folder]??'',effective:inherited(book,page),section,revision:manifest.revision};
  }
  let next={...manifest,themeBook:book},theme=book.items.find(t=>t.id===themeId);
  if(action==='create'||action==='design'){
   if(!validLabel(name)||!validAppearance(values)||!Object.keys(values).length||book.items.some(t=>t.id!==themeId&&t.name.toLowerCase()===name.trim().toLowerCase()))invalid();
   if(action==='create'){if(themeId!=null)invalid();theme={id:randomUUID()};book.items.push(theme);}
   if(!theme)throw new AppError('NOT_FOUND');
   Object.assign(theme,{name:name.trim(),values});
  }else if(action==='remove'){
   if(!theme)throw new AppError('NOT_FOUND');book.items=book.items.filter(t=>t!==theme);
   for(const collection of [book.pages,book.folders])for(const [key,id] of Object.entries(collection))if(id===themeId)delete collection[key];
  }else if(action!=='apply')invalid();
  if(action==='apply'||(action==='design'||action==='create')&&scope&&scope!=='library'){
   if(themeId!==null&&!theme)throw new AppError('NOT_FOUND');
   const selected=theme?.id??null;
   if(scope==='section'){
    const html=await store.readText(file,{signal}),node=sectionNode(parse(html,{sourceCodeLocationInfo:true}),blockPath);
    const updated=tag(html,node,themeAttr,selected);
    if(updated!==html){const replacement={...file,...await store.siteFile(id,page,updated,{draft:file.draft,signal})};next.files=manifest.files.map(f=>f===file?replacement:f);}
   }else{
    if(scope!=='page'&&(scope!=='folder'||!folder))invalid();
    const collection=scope==='page'?book.pages:book.folders,key=scope==='page'?page:folder;
    if(theme)collection[key]=selected;else delete collection[key];
   }
  }
  const saved=await store.commit(next,{signal});
  return {...await store.present(saved,page,{signal}),themeId:theme?.id??null};
 },{write,signal});
}
