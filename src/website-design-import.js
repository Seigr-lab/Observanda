import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseFragment,serialize} from 'parse5';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {canonicalPNG} from './canonical-png.js';
import {readDesignArchive} from './website-design-archive.js';
import {designFormat,designVersion,designPicture,designRecording,designResource,researchMarkup} from './website-design-package.js';
import {plainWebVTT,withPreparedRecording} from './website-recordings.js';
import {validateWebsiteCSS,websiteFileName,websiteHTMLByteLimit,websiteLocalURL} from './website-file-policy.js';
import {movedWebsiteText} from './website-page-paths.js';
import {researchId} from './web/research-reference.js';
import {validAppearance} from './web/website-appearance-model.js';
import {tokenGroups,validToken,tokenID} from './web/website-token-model.js';
import {defaultBreakpoints,validBreakpoints} from './web/website-breakpoint-model.js';
import {newStyleBook} from './website-style-resources.js';
import {prepareStyleFont,validStyleFont} from './website-style-fonts.js';
import {checkComponentSchema,componentDependencies} from './website-component-schema.js';
import {componentCSS} from './website-component-styles.js';
import {componentContext} from './website-component-storage.js';
import {prepareComponent} from './website-file-component.js';
import {REGION_SLOTS,regionSettings} from './website-region-model.js';
import {placeChangedRegions} from './website-region-storage.js';
import {remappedTemplate,storedDesignStyle} from './website-page-designs.js';
import {imageCandidates} from './web/website-image-candidates.js';
import {assertPublicFields} from './privacy.js';
import {operationAdvance,operationStage,operationTotal} from './operation-progress.js';

// Importing a design package is reviewed first: the review lists everything the
// package adds or replaces, renaming what would clash with names the site
// already uses. Applying the review adds the whole design in one saved change;
// files written on the way are discarded when it fails.
const bad=()=>{throw new AppError('WEBSITE_DESIGN_PACKAGE');};
const invalid=()=>{throw new AppError('INVALID');};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const fold=value=>value.trim().normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const builtin=id=>id==='tablet'||id==='phone';
const list=(value,max)=>{if(!Array.isArray(value)||value.length>max)bad();return value;};
const utf8=bytes=>{const value=bytes.toString('utf8');if(!Buffer.from(value).equals(bytes))bad();return value;};
const templateKeys='bodyClass,components,content,headingClass,rootClass,styleTokens';
const classAttribute=value=>value===''||typeof value==='string'&&/^ class="[^"<>]*"$/.test(value);

// Reads and checks a package. Everything is validated before any site is read.
export function readDesignPackage(bytes,{blockedValues=[]}={}){
 const files=readDesignArchive(bytes),used=new Set(['design.json']);
 let design;try{design=JSON.parse(utf8(files.get('design.json')));}catch(error){if(error instanceof AppError)throw error;bad();}
 if(!object(design)||design.format!==designFormat)bad();
 if(design.version!==designVersion)throw new AppError('WEBSITE_DESIGN_VERSION');
 const member=name=>{if(typeof name!=='string'||!files.has(name))bad();used.add(name);return files.get(name);};
 if(!text(design.name,200))bad();
 let stylesheet=null;
 if(design.stylesheet!==null){
  if(!object(design.stylesheet)||design.stylesheet.file!=='stylesheet.css'||typeof design.stylesheet.path!=='string'||!design.stylesheet.path.endsWith('.css'))bad();
  try{websiteFileName(design.stylesheet.path);}catch{bad();}
  stylesheet={path:design.stylesheet.path,css:utf8(member('stylesheet.css'))};
 }
 if(design.breakpoints!==null&&!validBreakpoints(design.breakpoints))bad();
 const themes=list(design.themes,500).map(t=>{if(!object(t)||!researchId(t.id)||!text(t.name,160)||!validAppearance(t.values))bad();return {id:t.id,name:t.name.trim(),values:t.values};});
 if(!object(design.styles))bad();
 const tokens=list(design.styles.tokens,2000),tokenIds=new Set(),classIds=new Set();
 for(const t of tokens){if(!validToken(t)||tokenIds.has(t.id)||classIds.has(t.classId))bad();tokenIds.add(t.id);classIds.add(t.classId);}
 const site=list(design.styles.site,Object.keys(tokenGroups).length);
 if(site.some(id=>!tokenIds.has(id))||new Set(site.map(id=>tokens.find(t=>t.id===id).group)).size!==site.length)bad();
 const fonts=list(design.fonts,100).map(font=>{
  if(!object(font)||typeof font.file!=='string'||font.file!=='fonts/'+font.file.slice(6)||!font.file.slice(6).startsWith(font.id+'.'))bad();
  return {...font,bytes:member('files/'+font.file)};
 });
 const fontIds=new Set(fonts.map(f=>f.id));
 for(const t of tokens)for(const state of Object.values(t.rules))if(state['font-family']?.startsWith('custom-')&&!fontIds.has(state['font-family']))bad();
 const components=list(design.components,1000),componentIds=new Set();
 for(const c of components){
  if(!object(c)||!uuid(c.id)||componentIds.has(c.id)||!text(c.name,100)||typeof c.html!=='string'||Buffer.byteLength(c.html)>64*1024||c.css!==undefined&&typeof c.css!=='string'||c.draft!==undefined&&c.draft!==true)bad();
  try{checkComponentSchema(c);}catch{bad();}
  if((c.variants??[]).some(v=>!classIds.has(v.style)))bad();
  componentIds.add(c.id);
 }
 for(const c of components)if((c.slots??[]).some(s=>s.type==='component'&&!componentIds.has(s.component)))bad();
 try{componentDependencies(new Map(components.map(c=>[c.id,c])));}catch{bad();}
 if(!object(design.regions)||Object.keys(design.regions).some(slot=>!REGION_SLOTS.includes(slot)))bad();
 const regions={};
 for(const [slot,entry] of Object.entries(design.regions)){
  if(!object(entry)||!componentIds.has(entry.component)||components.find(c=>c.id===entry.component).draft)bad();
  try{if(JSON.stringify(regionSettings(slot,entry.settings))!==JSON.stringify(entry.settings))bad();}catch{bad();}
  regions[slot]={component:entry.component,settings:entry.settings};
 }
 const designIds=new Set();
 const pageDesigns=list(design.pageDesigns,500).map(d=>{
  const t=d?.template;
  if(!object(d)||!uuid(d.id)||designIds.has(d.id)||!text(d.name,160)||d.stylesheet!=='page-designs/'+d.id+'.css'||!object(t)||Object.keys(t).sort().join()!==templateKeys)bad();
  if(![t.bodyClass,t.rootClass,t.headingClass].every(classAttribute)||typeof t.content!=='string'||Buffer.byteLength(t.content)>websiteHTMLByteLimit)bad();
  if(!Array.isArray(t.components)||t.components.some(id=>!componentIds.has(id))||!Array.isArray(t.styleTokens)||t.styleTokens.some(id=>!tokenIds.has(id)))bad();
  designIds.add(d.id);return {id:d.id,name:d.name.trim(),template:t,css:utf8(member(d.stylesheet))};
 });
 const resources=list(design.resources,1500).map(r=>{
  if(!object(r)||typeof r.name!=='string'||r.file!=='files/'+r.name||r.picture!==undefined&&r.picture!==true||r.recording!==undefined&&r.recording!==true||r.picture&&r.recording)bad();
  if(r.label!==undefined&&(!r.recording||!text(r.label,200)))bad();
  if(r.picture?!designPicture.test(r.name):r.recording?!designRecording.test(r.name):!designResource.test(r.name)||/^(?:pictures|recordings)\//.test(r.name))bad();
  return {name:r.name,picture:Boolean(r.picture),recording:Boolean(r.recording),...(r.label?{label:r.label}:{}),bytes:member(r.file)};
 });
 for(const font of fonts)used.add('files/'+font.file);
 const omitted=list(design.omitted??[],2000).map(row=>{if(!object(row)||!text(row.kind,40)||!text(row.name,200)||!text(row.reason,40))bad();return {kind:row.kind,name:row.name,reason:row.reason};});
 if([...files.keys()].some(name=>!used.has(name)))bad();
 // The same canary the export applies: research markup or private values refuse the package.
 for(const value of [JSON.stringify(design),stylesheet?.css??'',...pageDesigns.map(d=>d.css)])if(researchMarkup.test(value))throw new AppError('PRIVACY');
 assertPublicFields([{field:'design',value:design},{field:'stylesheet',value:stylesheet?.css??''},...pageDesigns.map(d=>({field:d.name,value:d.css}))],blockedValues);
 return {name:design.name.trim(),stylesheet,breakpoints:design.breakpoints,themes,tokens,site,fonts,components,regions,pageDesigns,resources,omitted,sha256:digest(bytes)};
}

// A name the site does not use yet: "Name", then "Name (2)", "Name (3)" ...
function unique(name,taken,max){
 let candidate=name,n=1;
 while(taken.has(fold(candidate))){n++;const suffix=' ('+n+')';candidate=name.slice(0,max-suffix.length).trimEnd()+suffix;}
 taken.add(fold(candidate));return candidate;
}
function uniqueFile(name,taken){
 const ext=path.posix.extname(name),base=name.slice(0,name.length-ext.length);let candidate=name,n=1;
 while(taken.has(candidate.toLowerCase())){n++;candidate=base+'-'+n+ext;}
 taken.add(candidate.toLowerCase());return candidate;
}

// Plans the import against a site: new identities for everything the package
// defines and the names they will have. Pure, so review and apply agree.
function plan(manifest,pkg){
 const rows=[],ids={themes:new Map(),tokens:new Map(),classes:new Map(),components:new Map(),designs:new Map()};
 const themeNames=new Set((manifest.themeBook?.items??[]).map(t=>fold(t.name)));
 const themes=pkg.themes.map(t=>{const id=randomUUID(),name=unique(t.name,themeNames,160);ids.themes.set(t.id,id);rows.push({kind:'theme',name,...(name!==t.name?{from:t.name}:{})});return {id,name,values:t.values};});
 const book=manifest.styleBook??newStyleBook(),tokenNames=new Set(book.tokens.map(t=>fold(t.name)));
 const tokens=pkg.tokens.map(t=>{const id=randomUUID(),classId=randomUUID(),name=unique(t.name,tokenNames,160);ids.tokens.set(t.id,id);ids.classes.set(t.classId,classId);rows.push({kind:'style',name,...(name!==t.name?{from:t.name}:{})});return {id,classId,group:t.group,name,rules:t.rules};});
 const known=new Set(book.fonts.map(f=>f.id));
 const fonts=pkg.fonts.filter(f=>!known.has(f.id));
 for(const f of fonts)rows.push({kind:'font',name:f.label});
 const ranges=structuredClone(manifest.breakpoints??defaultBreakpoints()),rangeIds=new Set(ranges.map(r=>r.id)),rangeNames=new Set(ranges.filter(r=>r.name).map(r=>fold(r.name)));
 for(const range of pkg.breakpoints??[]){
  if(builtin(range.id)||rangeIds.has(range.id))continue;
  const name=unique(range.name,rangeNames,160);ranges.push({...range,name});rows.push({kind:'breakpoint',name,...(name!==range.name?{from:range.name}:{})});
 }
 const componentNames=new Set((manifest.components??[]).map(c=>fold(c.name)));
 for(const c of pkg.components)ids.components.set(c.id,randomUUID());
 const components=pkg.components.map(c=>{const name=unique(c.name,componentNames,100);rows.push({kind:'component',name,...(name!==c.name?{from:c.name}:{}),...(c.draft?{draft:true}:{})});return {...c,id:ids.components.get(c.id),name};});
 const designNames=new Set((manifest.pageDesigns??[]).map(d=>fold(d.name)));
 const pageDesigns=pkg.pageDesigns.map(d=>{const id=randomUUID(),name=unique(d.name,designNames,160);ids.designs.set(d.id,id);rows.push({kind:'design',name,...(name!==d.name?{from:d.name}:{})});return {...d,id,name};});
 return {rows,ids,themes,tokens,fonts,ranges,components,pageDesigns};
}

// Rewrites site-root markup from a package: renamed files, the site's own
// themes and styles, and links to pages this site does not have removed.
function packageMarkup(html,{files,themes,classes,linkable}){
 const fragment=parseFragment(html),pending=[...fragment.childNodes];
 const local=value=>{const name=websiteLocalURL(value,'index.html');return name===null||!name?null:name;};
 const moved=value=>{const name=local(value);return name&&files.has(name.toLowerCase())?files.get(name.toLowerCase()):value;};
 while(pending.length){
  const node=pending.pop();
  if(node.attrs){
   node.attrs=node.attrs.filter(item=>{
    if(item.name==='data-website-theme'){if(!themes.has(item.value))return false;item.value=themes.get(item.value);}
    else if(item.name==='class')item.value=item.value.split(/\s+/).filter(Boolean).map(name=>name.startsWith('ow-token-')&&classes.has(name.slice(9))?'ow-token-'+classes.get(name.slice(9)):name).join(' ');
    else if(item.name==='href'){
     const name=local(item.value);if(!name||item.value.startsWith('#'))return true;
     if(files.has(name.toLowerCase())){item.value=files.get(name.toLowerCase());return true;}
     return linkable(name.split('#')[0]);
    }else if(item.name==='src'||item.name==='poster')item.value=moved(item.value);
    else if(item.name==='srcset')item.value=imageCandidates(item.value)?.map(({url,descriptor})=>moved(url)+(descriptor?' '+descriptor:'')).join(', ')??item.value;
    return true;
   });
  }
  if(node.content)pending.push(node.content);
  pending.push(...(node.childNodes??[]));
 }
 return serialize(fragment);
}

function choices(pkg,{stylesheet=false,regions=[]}={}){
 if(typeof stylesheet!=='boolean'||!Array.isArray(regions)||regions.some(slot=>!Object.hasOwn(pkg.regions,slot))||new Set(regions).size!==regions.length)invalid();
 if(stylesheet&&!pkg.stylesheet)invalid();
 return {stylesheet,regions:REGION_SLOTS.filter(slot=>regions.includes(slot))};
}
// The review covers the package against one saved revision; the stylesheet and
// region choices it offers are made explicitly when applying.
const reviewToken=(siteId,expectedRevision,pkg)=>digest(JSON.stringify(['website-design-import',siteId,expectedRevision,pkg.sha256]));

export async function reviewWebsiteDesign(store,siteId,{expectedRevision,path:address='index.html',bytes,options,blockedValues=[],signal}={}){
 if(!revision(expectedRevision))invalid();
 const pkg=readDesignPackage(bytes,{blockedValues}),choice=choices(pkg,options);
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision);
  if(!manifest.pages.some(p=>p.path===address))throw new AppError('NOT_FOUND');
  const {rows}=plan(manifest,pkg),components=new Map(pkg.components.map(c=>[c.id,c]));
  const regionRows=Object.entries(pkg.regions).map(([slot,entry])=>({slot,component:components.get(entry.component).name,current:manifest.regions?.slots?.[slot]?(manifest.components??[]).find(c=>c.id===manifest.regions.slots[slot].component)?.name??null:null}));
  return {revision:expectedRevision,reviewId:reviewToken(siteId,expectedRevision,pkg),name:pkg.name,rows,regions:regionRows,stylesheet:Boolean(pkg.stylesheet),omitted:pkg.omitted,counts:{resources:pkg.resources.length}};
 },{signal});
}

export async function applyWebsiteDesign(store,siteId,{expectedRevision,path:address='index.html',bytes,options,reviewId,blockedValues=[],signal}={}){
 if(!revision(expectedRevision))invalid();
 const pkg=readDesignPackage(bytes,{blockedValues}),choice=choices(pkg,options);
 if(reviewId!==reviewToken(siteId,expectedRevision,pkg))throw new AppError('CONFLICT');
 // Audio and video go through the same preparation as an authored upload,
 // outside the site writer so other edits continue during the conversion.
 // Each display copy is written to the site and committed below with the rest.
 await store.checkRevision(siteId,expectedRevision);
 const prepared=new Map(),release=async()=>{
  if(!prepared.size)return;
  await store.scope(async()=>{const live=new Set((await store.raw(siteId)).files.map(f=>f.blob));for(const file of prepared.values())if(!live.has(file.blob))await store.discardStaged(file.blob);},{write:true});
 };
 try{
  for(const r of pkg.resources){
   if(!r.recording||r.name.endsWith('.vtt')||!pkg.components.some(c=>c.html.includes(r.name)))continue;
   signal?.throwIfAborted();
   const name='recordings/'+randomUUID()+path.posix.extname(r.name),isPublic=pkg.components.some(c=>!c.draft&&c.html.includes(r.name));
   await withPreparedRecording(store,{name,size:r.bytes.length,bytes:async function*(){yield r.bytes;},signal},async upload=>{
    const file=await store.scope(()=>store.siteFile(siteId,name,upload,{draft:!isPublic,signal}),{write:true,signal});
    prepared.set(r.name,{...file,recording:true,...(r.label?{label:r.label}:{})});
   });
  }
  return await importDesign(store,siteId,{expectedRevision,address,pkg,choice,prepared,blockedValues,signal});
 }catch(error){await release();throw error;}
}
function importDesign(store,siteId,{expectedRevision,address,pkg,choice,prepared,blockedValues,signal}){
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision);
  if(!manifest.pages.some(p=>p.path===address))throw new AppError('NOT_FOUND');
  const planned=plan(manifest,pkg),{ids}=planned,priorBlobs=new Set(manifest.files.map(f=>f.blob)),staged=new Set();
  const preparedBlobs=new Set([...prepared.values()].map(f=>f.blob));
  const stage=file=>{if(!priorBlobs.has(file.blob)&&!preparedBlobs.has(file.blob))staged.add(file.blob);return file;};
  try{
   return await operationStage('designPackageImport',{unit:'files'},async()=>{
    const files=new Map(manifest.files.map(f=>[f.name,f])),taken=new Set(manifest.files.map(f=>f.name.toLowerCase()));
    // Which applied parts use each packaged file decides whether it is written at all.
    const users=new Map(pkg.resources.map(r=>[r.name,{public:false,used:false}]));
    const mark=(names,isPublic)=>{for(const name of names){const user=users.get(name);if(user){user.used=true;user.public||=isPublic;}}};
    const named=text=>[...pkg.resources.map(r=>r.name)].filter(name=>text.includes(name));
    for(const c of pkg.components)mark(named(c.html),!c.draft);
    for(const d of pkg.pageDesigns)mark(named(d.template.content+'\n'+d.css),true);
    if(choice.stylesheet)mark(named(pkg.stylesheet.css),true);
    operationTotal(pkg.resources.length+planned.fonts.length);
    const renamed=new Map();
    for(const resource of pkg.resources){
     signal?.throwIfAborted();
     const user=users.get(resource.name);
     if(!user.used){operationAdvance();continue;}
     if(resource.recording){
      let file=prepared.get(resource.name);
      if(!file){
       // Captions are admitted as timed text only, as when an author adds them.
       let vtt;try{vtt=plainWebVTT(resource.bytes.toString('utf8'));}catch{bad();}
       const name='recordings/'+randomUUID()+'.vtt';
       file={...await store.siteFile(siteId,name,{bytes:Buffer.from(vtt),contentType:'text/vtt; charset=utf-8'},{draft:!user.public,signal}),recording:true};
      }
      taken.add(file.name);files.set(file.name,stage(file));renamed.set(resource.name.toLowerCase(),file.name);
     }else if(resource.picture){
      let content;try{content=canonicalPNG(resource.bytes).content;}catch{bad();}
      const name='pictures/'+randomUUID()+'.png';taken.add(name);
      files.set(name,stage({...await store.siteFile(siteId,name,content,{draft:!user.public,signal}),picture:true}));renamed.set(resource.name.toLowerCase(),name);
     }else{
      const existing=files.get(resource.name);
      if(existing&&existing.sha256===digest(resource.bytes)&&!existing.sourceId&&!existing.feedAsset&&!existing.draft)renamed.set(resource.name.toLowerCase(),resource.name);
      else{
       const name=existing||taken.has(resource.name.toLowerCase())?uniqueFile(resource.name,taken):(taken.add(resource.name.toLowerCase()),resource.name);
       files.set(name,stage(await store.siteFile(siteId,name,resource.bytes,{draft:!user.public,signal})));renamed.set(resource.name.toLowerCase(),name);
      }
     }
     operationAdvance();
    }
    // Fonts are checked like an uploaded font, with their rights and notices.
    const book=structuredClone(manifest.styleBook??newStyleBook());
    for(const font of planned.fonts){
     const {font:checked,bytes}=await prepareStyleFont({encoded:font.bytes.toString('base64'),embed:font.embed,rights:font.rights,notice:font.notice,signal,blockedValues});
     if(checked.id!==font.id||!validStyleFont(checked))bad();
     const name='fonts/'+checked.faces[0].file,existing=files.get(name);
     if(existing&&(!existing.tokenFont||existing.sha256!==checked.id.slice(7)))throw new AppError('CONFLICT');
     if(!existing)files.set(name,stage({...await store.siteFile(siteId,name,bytes,{draft:true,signal}),tokenFont:true}));
     book.fonts.push(checked);operationAdvance();
    }
    book.tokens.push(...planned.tokens);
    const next={...manifest,styleBook:book,breakpoints:planned.ranges};
    if(planned.themes.length){const prior=manifest.themeBook??{items:[],pages:{},folders:{}};next.themeBook={...prior,items:[...prior.items,...planned.themes]};}
    const themes=new Set((next.themeBook?.items??[]).map(t=>t.id));
    const themeMap=new Map([...ids.themes].filter(([,id])=>themes.has(id)));
    for(const t of manifest.themeBook?.items??[])themeMap.set(t.id,t.id);
    const pages=new Map(manifest.pages.map(p=>[p.path,p]));
    const markup={files:renamed,themes:themeMap,classes:ids.classes,linkable:name=>{const page=pages.get(name);return Boolean(page&&!page.draft&&!page.placements.length&&!page.archived);}};
    // Components, each checked as a component written in the editor would be.
    const context={...componentContext({...next,files:[...files.values()]}),themes};
    const components=[];
    for(const c of planned.components){
     const html=packageMarkup(c.html,markup),draft=Boolean(c.draft);
     const shape={...(c.slots?{slots:c.slots.map(s=>s.type==='component'?{...s,component:ids.components.get(s.component)}:s)}:{}),...(c.variants?{variants:c.variants.map(v=>({...v,style:ids.classes.get(v.style)}))}:{})};
     let prepared;try{prepared=prepareComponent(html,'index.html',{...context,draft},shape);}catch(error){if(['INVALID','LIMIT','CONFLICT'].includes(error.code))bad();throw error;}
     const definition={id:c.id,name:c.name,...prepared,...shape,...(draft?{draft:true}:{})};
     if(c.css)try{definition.css=componentCSS(c.css,prepared.html,planned.ranges);}catch{bad();}
     if(!definition.slots?.length)delete definition.slots;
     if(!definition.variants?.length)delete definition.variants;
     if(!definition.css)delete definition.css;
     components.push(definition);
    }
    if(components.length)next.components=[...(manifest.components??[]),...components];
    // Page designs are stored designs, each with its private stylesheet.
    const pictureStyles={...manifest.pictureStyles};
    if(planned.pageDesigns.length)next.pageDesigns=[...(manifest.pageDesigns??[])];
    for(const d of planned.pageDesigns){
     const t=remappedTemplate(d.template,{components:ids.components,themes:ids.themes,tokens:ids.tokens,classes:ids.classes});
     const template={...t,content:packageMarkup(t.content,markup)},sheetName=storedDesignStyle(d.id);
     const css=movedWebsiteText(d.css,sheetName,sheetName,renamed);
     try{validateWebsiteCSS(css,{file:sheetName});}catch{bad();}
     if(files.has(sheetName))throw new AppError('CONFLICT');
     files.set(sheetName,stage(await store.siteFile(siteId,sheetName,css,{draft:true,signal})));
     const pictures=new Set();
     for(const name of renamed.values())if(name.startsWith('pictures/')&&(template.content.includes(name)||css.includes(name)))pictures.add(name);
     pictureStyles[sheetName]=[...pictures];
     next.pageDesigns.push({id:d.id,name:d.name,template});
    }
    // The site stylesheet and site-wide page styles, when chosen.
    if(choice.stylesheet){
     const css=movedWebsiteText(pkg.stylesheet.css,pkg.stylesheet.path,manifest.cssPath,renamed),pictures=new Set();
     try{validateWebsiteCSS(css,{file:manifest.cssPath,pictures});}catch{bad();}
     for(const name of pictures)if(!files.get(name)||files.get(name).draft)bad();
     files.set(manifest.cssPath,stage(await store.siteFile(siteId,manifest.cssPath,css,{signal})));
     pictureStyles[manifest.cssPath]=[...pictures];
     const groups=new Map(book.tokens.map(t=>[t.id,t.group])),chosen=pkg.site.map(id=>ids.tokens.get(id)),replaced=new Set(chosen.map(id=>groups.get(id)));
     book.site=[...book.site.filter(id=>!replaced.has(groups.get(id))),...chosen];
    }
    next.files=[...files.values()];
    if(Object.keys(pictureStyles).length)next.pictureStyles=pictureStyles;
    // Region slots, when chosen, show their imported component on every page.
    let candidate=next;
    if(choice.regions.length){
     const regions=structuredClone(manifest.regions??{slots:{},overrides:[]});
     for(const slot of choice.regions)regions.slots[slot]={component:ids.components.get(pkg.regions[slot].component),settings:pkg.regions[slot].settings};
     candidate=await operationStage('regionSave',{unit:'files'},()=>placeChangedRegions(store,siteId,manifest,{...next,regions},{signal,stage:'regionSave'}));
    }
    // A malformed package must never leave an unreadable site behind.
    try{store.validateManifest({...candidate,version:1,revision:'0'.repeat(64)},siteId);}catch(error){if(error.code==='FORMAT')bad();throw error;}
    await store.assertSources(candidate);
    const saved=await store.commit(candidate,{signal});
    return {...await store.present(saved,address,{signal}),imported:planned.rows.length};
   });
  }catch(error){
   if(staged.size&&(await store.raw(siteId)).revision===expectedRevision)for(const blob of staged)await store.discardStaged(blob);
   throw error;
  }
 },{write:true,signal});
}
