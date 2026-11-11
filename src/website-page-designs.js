import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse,parseFragment,serialize} from 'parse5';
import {AppError} from './errors.js';
import {attr} from './website-migration-views.js';
import {websiteFileName,websiteHTMLByteLimit} from './website-file-policy.js';
import {attachGalleryViewer} from './website-gallery-support.js';
import {escapeWebsiteText} from './website-file-html.js';
import {starterPage} from './web/website-file-starter.js';
import {componentContext} from './website-component-storage.js';
import {renderComponentInstance} from './website-file-component.js';
import {publicPictureNames} from './website-picture-files.js';
import {designStyleCopies} from './website-design-styles.js';
import {publicRecordingNames,websiteRecordingKind} from './website-recordings.js';
import {imageCandidates} from './web/website-image-candidates.js';
import {readImageFrame,imageFrameClasses} from './web/website-image-frame.js';

const invalid=()=>{throw new AppError('INVALID');};
const named=value=>typeof value==='string'&&value.trim()&&value.length<=160?value.trim():invalid();
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fold=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const windowSize=24,esc=escapeWebsiteText;
const slots=new Set('section article aside div h2 h3 h4 h5 h6 p blockquote details summary ol ul li dl dt dd figure figcaption picture source table caption thead tbody tfoot tr th td span strong em b i u sub sup mark code pre hr a img audio video'.split(' '));
const layoutClasses=new Set('website-columns website-column container-content container-column site-section site-gallery gallery-columns-1 gallery-columns-2 gallery-columns-3 gallery-columns-4 ow-access-target ow-access-focus ow-access-fit'.split(' '));
const lengths=/^(?:(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?(?:px|rem|em|%|fr|vw|vh)|0|auto|max-content|min-content|1fr)$/;
const passiveLayout={display:['block','grid','flex'],'flex-direction':['row','column','row-reverse','column-reverse'],'flex-wrap':['wrap','nowrap'],'align-items':['start','end','center','stretch','baseline'],'justify-content':['start','end','center','space-between','space-evenly','space-around'],'text-align':['start','end','center','justify'],'font-family':['serif','sans-serif','monospace','system-ui'],'font-style':['normal','italic'],'border-style':['solid','dashed','dotted','double','none']};
function layoutStyle(raw=''){
 const output=[];
 for(const declaration of raw.split(';')){
  const [prop,value,...other]=declaration.split(':').map(s=>s.trim().toLowerCase());if(other.length||!value)continue;
  if(Object.hasOwn(passiveLayout,prop)&&passiveLayout[prop].includes(value)||
     /^(?:gap|row-gap|column-gap|padding|margin|max-width|min-width|width|grid-template-columns|border-radius|border-width|font-size|letter-spacing)$/.test(prop)&&value.split(/\s+/).every(v=>lengths.test(v))||
     /^(?:color|background-color|border-color)$/.test(prop)&&/^(?:#[\da-f]{3}|#[\da-f]{6}|#[\da-f]{8}|transparent|currentcolor)$/.test(value))output.push(prop+':'+value);
 }
 return output.join(';');
}
// Site regions are left out: a page made from a design receives its site's regions.
const ownedMarker=name=>name.startsWith('data-observanda-')||name.startsWith('data-website-feed')||['hidden','data-public-record','data-record-id','data-feed-item','data-website-source-gallery','data-website-menu','data-image-gallery','data-website-region'].includes(name);
const skipped=node=>node.attrs?.some(a=>ownedMarker(a.name)||a.name==='aria-hidden'&&a.value.toLowerCase()==='true'||a.name==='style'&&/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)\b/i.test(a.value));
// A design is live (generated from its source page) or stored (a portable
// template kept with its own private stylesheet, independent of any page).
export const storedDesignStyle=id=>'page-design-'+id+'.css';
const classAttribute=value=>value===''||typeof value==='string'&&/^ class="[^"<>]*"$/.test(value);
function validTemplate(item,files,manifest){
 const t=item.template,css=files.get(storedDesignStyle(item.id));
 if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).sort().join()!=='bodyClass,components,content,headingClass,rootClass,styleTokens')return false;
 if(![t.bodyClass,t.rootClass,t.headingClass].every(classAttribute)||typeof t.content!=='string'||Buffer.byteLength(t.content)>websiteHTMLByteLimit)return false;
 const components=new Set((manifest.components??[]).map(row=>row.id)),tokens=new Set((manifest.styleBook?.tokens??[]).map(row=>row.id));
 if(!Array.isArray(t.components)||t.components.some(id=>!components.has(id))||!Array.isArray(t.styleTokens)||t.styleTokens.some(id=>!tokens.has(id)))return false;
 return Boolean(css&&css.draft&&!css.sourceId&&!css.feedAsset);
}
export function validatePageDesigns(manifest){
 if(manifest.pageDesigns===undefined)return;
 if(!Array.isArray(manifest.pageDesigns))throw new AppError('FORMAT');
 const ids=new Set(),sources=new Set(),labels=new Set(),files=new Map(manifest.files.map(file=>[file.name,file]));
 for(const item of manifest.pageDesigns){
  if(!uuid(item?.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>160||labels.has(fold(item.name)))throw new AppError('FORMAT');
  if(item.template!==undefined){if(item.source!==undefined||!validTemplate(item,files,manifest))throw new AppError('FORMAT');}
  else{
   if(typeof item.source!=='string'||!item.source.endsWith('.html')||sources.has(item.source))throw new AppError('FORMAT');
   websiteFileName(item.source);sources.add(item.source);
  }
  ids.add(item.id);labels.add(fold(item.name));
 }
}
// A stored template written for the page that uses it: root-relative links are
// rewritten from the destination's folder and themes the site no longer has
// are left out.
function instantiateTemplate(content,destination,themes){
 const base=path.posix.dirname(destination),local=value=>base==='.'||!value||value.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(value)?value:path.posix.relative(base,value.split('#')[0])+(value.includes('#')?'#'+value.split('#').slice(1).join('#'):'');
 const fragment=parseFragment(content),pending=[...fragment.childNodes];
 while(pending.length){
  const node=pending.pop();
  if(node.attrs)node.attrs=node.attrs.filter(item=>item.name!=='data-website-theme'||themes.has(item.value));
  for(const item of node.attrs??[]){
   if(['href','src','poster'].includes(item.name))item.value=local(item.value);
   if(item.name==='srcset')item.value=imageCandidates(item.value)?.map(({url,descriptor})=>local(url)+(descriptor?' '+descriptor:'')).join(', ')??item.value;
  }
  pending.push(...(node.childNodes??[]));
 }
 return serialize(fragment);
}
// The same template with the site identities it names replaced, for a copied
// site or an imported design. Unknown identities are kept as they are.
export function remappedTemplate(template,{components=new Map(),themes=new Map(),tokens=new Map(),classes=new Map()}={}){
 const fragment=parseFragment(template.content),pending=[...fragment.childNodes];
 while(pending.length){
  const node=pending.pop();
  for(const item of node.attrs??[]){
   if(item.name==='data-website-design-component')item.value=components.get(item.value)??item.value;
   else if(item.name==='data-website-theme')item.value=themes.get(item.value)??item.value;
   else if(item.name==='class')item.value=item.value.split(/\s+/).filter(Boolean).map(name=>name.startsWith('ow-token-')&&classes.has(name.slice(9))?'ow-token-'+classes.get(name.slice(9)):name).join(' ');
  }
  pending.push(...(node.childNodes??[]));
 }
 const named=value=>value.replace(/ow-token-([0-9a-f-]{36})/g,(whole,id)=>classes.has(id)?'ow-token-'+classes.get(id):whole);
 return {...template,bodyClass:named(template.bodyClass),rootClass:named(template.rootClass),headingClass:named(template.headingClass),content:serialize(fragment),
  components:template.components.map(id=>components.get(id)??id),styleTokens:template.styleTokens.map(id=>tokens.get(id)??id)};
}
// The pictures a template needs, by site file name (template links are root-relative).
function templatePictures(content,css,files){
 const names=new Set(),pending=[...parseFragment(content).childNodes];
 while(pending.length){
  const node=pending.pop();
  for(const item of node.attrs??[]){
   const values=item.name==='src'||item.name==='poster'?[item.value]:item.name==='srcset'?(imageCandidates(item.value)??[]).map(c=>c.url):[];
   for(const value of values)if(files.get(value)?.picture)names.add(value);
  }
  pending.push(...(node.childNodes??[]));
 }
 for(const match of css.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g))if(files.get(match[1])?.picture)names.add(match[1]);
 return [...names];
}
function usable(files,page){
 const file=page&&files.get(page.path);
 return file&&!page.draft&&!file.draft&&!file.sourceId&&!file.feedPage;
}
// Builds a design from its source page. A portable design is written from the
// site root and keeps components as placeholders, so it can be stored and used
// anywhere later (see instantiateTemplate).
function pageDesignParts(manifest,owner,file,html,destination,labels,styles,{portable=false}={}){
 const context=componentContext(manifest),instances=[],sourceInstances=new Map((owner.instances??[]).map(i=>[i.id,i]));
 const availableTokens=new Set((file.tokenUsage??[]).map(id=>'ow-token-'+id));
 const pictures=publicPictureNames(manifest),recordings=publicRecordingNames(manifest);
 const feedHosts=new Set(manifest.feeds?.map(feed=>feed.path));
 const settings={heading:named(labels?.heading),text:named(labels?.text),image:named(labels?.image)};
 const sourceDir=path.posix.dirname(owner.path),outDir=path.posix.dirname(destination);
 const document=parse(html),body=document.childNodes.find(n=>n.tagName==='html')?.childNodes.find(n=>n.tagName==='body');
 const candidates=[...(body?.childNodes??[])].reverse();let root=body;
 while(candidates.length){
  const node=candidates.pop();if(!node.tagName||skipped(node)||['header','footer','nav','template'].includes(node.tagName))continue;
  if(node.tagName==='main'){root=node;break;}
  for(let i=node.childNodes.length-1;i>=0;i--)candidates.push(node.childNodes[i]);
 }
 const ownedIds=new Map(),references=new Set(),anchors=new Map(),nodes=[...(root?.childNodes??[])].reverse();
 while(nodes.length){
  const node=nodes.pop();if(!slots.has(node.tagName)||skipped(node)||attr(node,'data-website-instance')!==undefined)continue;
  const id=attr(node,'id'),link=node.tagName==='a'?attr(node,'href'):null;
  if(id&&!['a','img','audio','video'].includes(node.tagName))ownedIds.set(id,ownedIds.has(id)?null:node);
  if(link?.includes('#'))references.add(link.slice(link.indexOf('#')+1));
  for(let i=node.childNodes.length-1;i>=0;i--)nodes.push(node.childNodes[i]);
 }
 for(const id of references)if(ownedIds.get(id))anchors.set(id,'section-'+randomUUID());
 function resource(value,type){
  // Only a site-authored, publicly owned file can travel with an unlinked slot.
  if(!value||value.startsWith('/')||/[\\%:?\s\u0000-\u001f]/.test(value))return null;
  const [file,hash,...extra]=value.split('#');if(extra.length||hash!==undefined&&(type!=='link'||!hash))return null;
  const name=file?path.posix.normalize(path.posix.join(sourceDir,file)):owner.path,asset=context.files.get(name);
  if(type==='link'&&name===owner.path&&hash)return anchors.has(hash)?'#'+anchors.get(hash):null;
  if(!asset||asset.draft||asset.sourceId||asset.feedAsset||asset.feedPage||asset.themeSheet)return null;
  if(type==='link'){
   const target=context.pages.get(name);
   if(!usable(context.files,target)||target.placements?.length||target.sourceGalleries?.length||feedHosts.has(name))return null;
  }else if(type==='img'?!asset.picture||!pictures.has(name):websiteRecordingKind(asset)!==type||!recordings.has(name))return null;
  return esc(path.posix.relative(outDir,name)+(hash?'#'+hash:''));
 }
 function designClass(node){
  const classes=(attr(node,'class')??'').split(/\s+/).map(c=>layoutClasses.has(c)||availableTokens.has(c)?c:styles.copy(c)).filter(Boolean);
  return classes.length?' class="'+esc(classes.join(' '))+'"':'';
 }
 function designNode(node){
  if(!node.tagName||skipped(node))return '';
  const placed=attr(node,'data-website-instance');
  if(placed!==undefined){
   const row=sourceInstances.get(placed),definition=context.components.get(row?.component);
   if(!row||!definition||definition.draft)throw new AppError('CONFLICT');
   if(portable)return '<div data-website-design-component="'+definition.id+'"></div>';
   const instance={id:randomUUID(),component:definition.id};instances.push(instance);
   return renderComponentInstance(definition,instance,{path:destination},context);
  }
  const tag=node.tagName;if(!slots.has(tag))return '';
  if(tag==='picture'){
   const fallback=node.childNodes.find(child=>child.tagName==='img'&&!skipped(child));
   if(!fallback||!resource(attr(fallback,'src'),'img'))return '';
  }
  if(tag==='source'){
   if(node.parentNode?.tagName!=='picture')return '';
   const candidates=imageCandidates(attr(node,'srcset')??'')?.flatMap(({url,descriptor})=>{
    const name=resource(url,'img');return name?[name+(descriptor?' '+descriptor:'')]:[];
   })??[];
   if(!candidates.length)return '';
   const media=attr(node,'media')??'';
   if(media&&!/^\(\s*(?:(?:min-|max-)?(?:width|height|resolution)\s*:\s*[\d.]+(?:px|em|rem|dpi|dppx)|orientation\s*:\s*(?:landscape|portrait))\s*\)(?:\s+and\s+\(\s*(?:min-|max-)?(?:width|height|resolution)\s*:\s*[\d.]+(?:px|em|rem|dpi|dppx)\s*\))*$/i.test(media))return '';
   return '<source srcset="'+candidates.join(', ')+'"'+(candidates[0].endsWith('w')?' sizes="auto, 100vw"':'')+(media?' media="'+esc(media)+'"':'')+'>';
  }
  let url;
  if(tag==='a'){
   url=resource(attr(node,'href'),'link');if(!url)return {open:'',close:'',sample:''};
  }else if(tag==='img'){
   url=resource(attr(node,'src'),'img');if(!url)return '';
  }else if(tag==='audio'||tag==='video'){
   const source=node.childNodes.find(child=>child.tagName==='source'&&!skipped(child));
   url=resource(attr(node,'src')??(source?attr(source,'src'):''),tag);if(!url)return '';
  }
  const style=layoutStyle(attr(node,'style')),theme=attr(node,'data-website-theme');
  let attrs=designClass(node)+(style?' style="'+esc(style)+'"':'');
  if(tag==='p'&&attr(node,'data-website-annotation')==='')attrs+=' data-website-annotation=""';
  const anchor=anchors.get(attr(node,'id'));if(anchor)attrs+=' id="'+anchor+'"';
  if(theme&&context.themes.has(theme)&&file.usedThemes?.includes(theme))attrs+=' data-website-theme="'+esc(theme)+'"';
  if(tag==='hr')return '<hr'+attrs+'>';
  if(tag==='img'){
   const responsive=imageCandidates(attr(node,'srcset')??'')?.flatMap(({url,descriptor})=>{
    const name=resource(url,'img');return name?[name+(descriptor?' '+descriptor:'')]:[];
   })??[];
   const frame=(attr(node,'class')??'').includes('wi-ratio-')?imageFrameClasses(readImageFrame(attr(node,'class'))).join(' '):'';
   if(frame)attrs=attrs.startsWith(' class="')?attrs.replace(' class="',' class="'+frame+' '):' class="'+frame+'"'+attrs;
   const dimensions=['width','height'].map(key=>/^[1-9]\d{0,6}$/.test(attr(node,key))?' '+key+'="'+attr(node,key)+'"':'').join('');
   return '<img'+attrs+' src="'+url+'" alt="'+esc(settings.image)+'"'+dimensions+(responsive.length?' loading="lazy" srcset="'+responsive.join(', ')+'"'+(responsive[0].endsWith('w')?' sizes="auto, 100vw"':''):'')+'>';
  }
  if(tag==='audio'||tag==='video'){
   const tracks=node.childNodes.flatMap(track=>{
    if(track.tagName!=='track'||skipped(track))return [];
    const href=resource(attr(track,'src'),'track'),lang=attr(track,'srclang')??'',kind=attr(track,'kind');
    return href&&['captions','subtitles'].includes(kind)&&/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(lang)?['<track kind="'+kind+'" srclang="'+esc(lang)+'" src="'+href+'">']:[];
   }).join('');
   return '<'+tag+attrs+' controls preload="metadata" src="'+url+'">'+tracks+'</'+tag+'>';
  }
  if(tag==='a')return {open:'<a'+attrs+' href="'+url+'">',close:'</a>',sample:settings.text};
  const sample=/^(?:h[2-6]|summary|caption|th)$/.test(tag)?settings.heading:/^(?:p|pre|td|li|blockquote|figcaption|strong|em|b|i|u|sub|sup|mark|code)$/.test(tag)?settings.text:'';
  return {open:'<'+tag+attrs+'>',close:'</'+tag+'>',sample};
 }
 let allowed=Boolean(root);for(let parent=root;parent;parent=parent.parentNode)if(skipped(parent))allowed=false;
 const chunks=[],stack=[];let bytes=0;
 const append=s=>{if(!s)return;bytes+=Buffer.byteLength(s);if(bytes>websiteHTMLByteLimit)throw new AppError('LIMIT');chunks.push(s);};
 const queue=nodes=>{for(let i=nodes.length-1;i>=0;i--)stack.push({node:nodes[i]});};
 if(allowed)queue(root.childNodes);
 while(stack.length){
  const entry=stack.pop();
  if(!entry.node){if(chunks.length===entry.start)append(esc(entry.sample));append(entry.close);continue;}
  const part=designNode(entry.node);if(typeof part==='string'){append(part);continue;}
  append(part.open);stack.push({start:chunks.length,close:part.close,sample:part.sample});queue(entry.node.childNodes??[]);
 }
 const heading=allowed?root.childNodes.find(n=>n.tagName==='h1'&&!skipped(n)):null;
 return {bodyClass:allowed?designClass(body):'',rootClass:allowed&&root!==body?designClass(root):'',headingClass:heading?designClass(heading):'',content:chunks.join(''),instances};
}
function assembleDesign(manifest,parts,destination,title,language){
 const starter=starterPage({title,language,stylesheet:path.posix.relative(path.posix.dirname(destination),manifest.cssPath)},esc)
  .replace('<body><main><h1>',()=>'<body'+parts.bodyClass+'><main'+parts.rootClass+'><h1'+parts.headingClass+'>');
 return attachGalleryViewer(starter.replace('</main>',()=>parts.content+'</main>'),destination);
}
function pageDesignHTML(manifest,owner,file,html,destination,title,language,labels,styles){
 const parts=pageDesignParts(manifest,owner,file,html,destination,labels,styles);
 return {html:assembleDesign(manifest,parts,destination,title,language),instances:parts.instances};
}
// A live design reads its published source page and the stylesheets it uses.
async function designSource(store,manifest,owner,files,signal){
 const file=files.get(owner.path),css=files.get(manifest.cssPath);
 if(!file||file.draft||!css||css.draft||css.sourceId)invalid();
 const ownStyle=owner.stylePath?files.get(owner.stylePath):null;
 const published=new Map((manifest.publicPageFiles??[]).map(row=>[row.file.name,row.file]));
 const sourceCSS=await store.readText(published.get(css.name)??css,{signal})+(ownStyle?'\n'+await store.readText(published.get(ownStyle.name)??ownStyle,{signal}):'');
 return {file,styles:designStyleCopies(sourceCSS,manifest.breakpoints)};
}
// A design in portable form: the template, its stylesheet and the site pictures
// it uses. A stored design is read as kept; a live one is generated from its
// published page. Callers hold the store scope.
export async function portablePageDesign(store,manifest,design,labels,signal){
 const files=new Map(manifest.files.map(f=>[f.name,f]));
 if(design.template){
  const sheet=files.get(storedDesignStyle(design.id));if(!sheet)throw new AppError('NOT_FOUND');
  return {template:design.template,css:await store.readText(sheet,{signal}),pictures:[...(manifest.pictureStyles?.[storedDesignStyle(design.id)]??[])]};
 }
 const owner=manifest.pages.find(p=>p.path===design.source);
 if(!usable(files,owner))throw new AppError('NOT_FOUND');
 const {file,styles}=await designSource(store,manifest,owner,files,signal);
 const parts=pageDesignParts(manifest,owner,file,await store.readText(file,{signal}),'index.html',labels,styles,{portable:true});
 const css=styles.copiedRules(layoutClasses);
 const template={bodyClass:parts.bodyClass,rootClass:parts.rootClass,headingClass:parts.headingClass,content:parts.content,
  components:[...new Set([...parts.content.matchAll(/data-website-design-component="([^"]+)"/g)].map(m=>m[1]))],styleTokens:[...(manifest.styleBook?.pages[owner.path]??[])]};
 return {template,css,pictures:templatePictures(parts.content,css,files)};
}
export function websitePageDesigns(store,siteId,options){
 const {action,expectedRevision,path:sourcePath,signal}=options;
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!['list','name','forget','use','keep'].includes(action))invalid();
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision),catalogue=manifest.pageDesigns??[],pages=new Map(manifest.pages.map(p=>[p.path,p])),files=new Map(manifest.files.map(f=>[f.name,f]));
  if(action==='list'){
   const {offset=0,query=''}=options;if(!Number.isSafeInteger(offset)||offset<0||typeof query!=='string'||query.length>160)invalid();
   const items=[];let total=0,local=null;
   for(const item of catalogue){
    if(!item.template&&!usable(files,pages.get(item.source)))continue;
    // Rows carry what the chooser shows, never a stored template's content.
    const row={id:item.id,name:item.name,...(item.template?{stored:true}:{source:item.source})};
    if(!item.template&&item.source===sourcePath)local=row;
    if(!fold(item.name).includes(fold(query)))continue;
    if(total>=offset&&items.length<windowSize)items.push(row);total++;
   }
   return {revision:manifest.revision,local,items,total,previous:Math.max(0,offset-windowSize),next:offset+items.length<total?offset+items.length:null};
  }
  const stored=catalogue.find(d=>d.template&&d.id===options.design);
  if(action==='forget'&&stored){
   // The template's private stylesheet and its picture group leave with it.
   const name=storedDesignStyle(stored.id),pictureStyles={...manifest.pictureStyles};delete pictureStyles[name];
   const kept=new Set([...manifest.pages.flatMap(p=>p.pictures??[]),...Object.values(pictureStyles).flat()]);
   const changed=await store.commit({...manifest,pageDesigns:catalogue.filter(d=>d!==stored),pictureStyles,files:manifest.files.filter(f=>f.name!==name&&(!f.picture||kept.has(f.name)))},{signal});
   return store.present(changed,sourcePath,{signal});
  }
  if(action==='keep'){
   const design=catalogue.find(d=>d.id===options.design&&!d.template),owner=pages.get(design?.source);
   if(!usable(files,owner))throw new AppError('NOT_FOUND');
   const {template,css,pictures}=await portablePageDesign(store,manifest,design,options.labels,signal),name=storedDesignStyle(design.id);
   const sheet=await store.siteFile(siteId,name,css,{draft:true,signal});
   const candidate={...manifest,pageDesigns:catalogue.map(d=>d===design?{id:d.id,name:d.name,template}:d),files:[...manifest.files.filter(f=>f.name!==name),sheet],pictureStyles:{...manifest.pictureStyles,[name]:pictures}};
   return store.present(await store.commit(candidate,{signal}),sourcePath,{signal});
  }
  if(action==='name'||action==='forget'){
   if(!usable(files,pages.get(sourcePath)))invalid();
   const existing=catalogue.find(d=>d.source===sourcePath),other=catalogue.filter(d=>d!==existing);
   if(action==='name'){
    const name=named(options.name);if(other.some(d=>fold(d.name)===fold(name)))invalid();
    other.push({id:existing?.id??randomUUID(),name,source:sourcePath});
   }else if(!existing)throw new AppError('NOT_FOUND');
   const changed=await store.commit({...manifest,pageDesigns:other},{signal});return store.present(changed,sourcePath,{signal});
  }
  const design=catalogue.find(d=>d.id===options.design),owner=pages.get(design?.source);
  if(!design||!design.template&&!usable(files,owner))throw new AppError('NOT_FOUND');
  const out=websiteFileName(options.destination);
  if(!out.endsWith('.html')||manifest.files.some(f=>f.name.toLowerCase()===out.toLowerCase()))invalid();
  const title=named(options.title),language=typeof options.language==='string'&&options.language.length<=80?options.language:'en';
  if(design.template){
   const t=design.template,context=componentContext(manifest),instances=[];
   const content=instantiateTemplate(t.content,out,context.themes).replace(/<div data-website-design-component="([^"]+)"><\/div>/g,(_,id)=>{
    const definition=context.components.get(id);if(!definition||definition.draft)throw new AppError('CONFLICT');
    const instance={id:randomUUID(),component:id};instances.push(instance);return renderComponentInstance(definition,instance,{path:out},context);
   });
   const css=await store.readText(files.get(storedDesignStyle(design.id)),{signal});
   return store.createPage(siteId,{expectedRevision,path:out,title,language,inclusion:options.inclusion,signal},{html:assembleDesign(manifest,{...t,content},out,title,language),instances,css,styleTokens:t.styleTokens});
  }
  const {file,styles}=await designSource(store,manifest,owner,files,signal);
  const generated=pageDesignHTML(manifest,owner,file,await store.readText(file,{signal}),out,title,language,options.labels,styles);
  return store.createPage(siteId,{expectedRevision,path:out,title,language,inclusion:options.inclusion,signal},{...generated,css:styles.copiedRules(layoutClasses),styleTokens:manifest.styleBook?.pages[owner.path]});
 },{write:action!=='list',signal});
}
