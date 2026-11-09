import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse} from 'parse5';
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
const ownedMarker=name=>name.startsWith('data-observanda-')||name.startsWith('data-website-feed')||['hidden','data-public-record','data-record-id','data-feed-item','data-website-source-gallery','data-website-menu','data-image-gallery'].includes(name);
const skipped=node=>node.attrs?.some(a=>ownedMarker(a.name)||a.name==='aria-hidden'&&a.value.toLowerCase()==='true'||a.name==='style'&&/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)\b/i.test(a.value));
export function validatePageDesigns(manifest){
 if(manifest.pageDesigns===undefined)return;
 if(!Array.isArray(manifest.pageDesigns))throw new AppError('FORMAT');
 const ids=new Set(),sources=new Set(),labels=new Set();
 for(const item of manifest.pageDesigns){
  if(!uuid(item?.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>160||labels.has(fold(item.name))||typeof item.source!=='string'||!item.source.endsWith('.html')||sources.has(item.source))throw new AppError('FORMAT');
  websiteFileName(item.source);ids.add(item.id);sources.add(item.source);labels.add(fold(item.name));
 }
}
function usable(files,page){
 const file=page&&files.get(page.path);
 return file&&!page.draft&&!file.draft&&!file.sourceId&&!file.feedPage;
}
function pageDesignHTML(manifest,owner,file,html,destination,title,language,labels,styles){
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
 let starter=starterPage({title,language,stylesheet:path.posix.relative(outDir,manifest.cssPath)},esc);
 if(allowed){
  const heading=root.childNodes.find(n=>n.tagName==='h1'&&!skipped(n));
  starter=starter.replace('<body><main><h1>',()=>'<body'+designClass(body)+'><main'+(root===body?'':designClass(root))+'><h1'+(heading?designClass(heading):'')+'>');
 }
 return {html:attachGalleryViewer(starter.replace('</main>',()=>chunks.join('')+'</main>'),destination),instances};
}
export function websitePageDesigns(store,siteId,options){
 const {action,expectedRevision,path:sourcePath,signal}=options;
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!['list','name','forget','use'].includes(action))invalid();
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision),catalogue=manifest.pageDesigns??[],pages=new Map(manifest.pages.map(p=>[p.path,p])),files=new Map(manifest.files.map(f=>[f.name,f]));
  if(action==='list'){
   const {offset=0,query=''}=options;if(!Number.isSafeInteger(offset)||offset<0||typeof query!=='string'||query.length>160)invalid();
   const items=[];let total=0,local=null;
   for(const item of catalogue){
    if(!usable(files,pages.get(item.source)))continue;
    if(item.source===sourcePath)local=item;
    if(!fold(item.name).includes(fold(query)))continue;
    if(total>=offset&&items.length<windowSize)items.push(item);total++;
   }
   return {revision:manifest.revision,local,items,total,previous:Math.max(0,offset-windowSize),next:offset+items.length<total?offset+items.length:null};
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
  if(!usable(files,owner))throw new AppError('NOT_FOUND');
  const out=websiteFileName(options.destination);
  if(!out.endsWith('.html')||manifest.files.some(f=>f.name.toLowerCase()===out.toLowerCase()))invalid();
  const file=manifest.files.find(f=>f.name===owner.path),css=manifest.files.find(f=>f.name===manifest.cssPath);
  if(!file||file.draft||!css||css.draft||css.sourceId)invalid();
  const title=named(options.title),language=typeof options.language==='string'&&options.language.length<=80?options.language:'en';
  const ownStyle=owner.stylePath?files.get(owner.stylePath):null;
  const published=new Map((manifest.publicPageFiles??[]).map(row=>[row.file.name,row.file]));
  const sourceCSS=await store.readText(published.get(css.name)??css,{signal})+(ownStyle?'\n'+await store.readText(published.get(ownStyle.name)??ownStyle,{signal}):'');
  const styles=designStyleCopies(sourceCSS,manifest.breakpoints);
  const generated=pageDesignHTML(manifest,owner,file,await store.readText(file,{signal}),out,title,language,options.labels,styles);
  return store.createPage(siteId,{expectedRevision,path:out,title,language,inclusion:options.inclusion,signal},{...generated,css:styles.copiedRules(layoutClasses),styleTokens:manifest.styleBook?.pages[owner.path]});
 },{write:action!=='list',signal});
}
