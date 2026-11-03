import path from 'node:path';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {attr,descendants} from './website-migration-views.js';
import {appearanceColors,appearanceCSS,validAppearance} from './web/website-appearance-model.js';

const marker='data-website-appearance',safeSheet=name=>typeof name==='string'&&/^website-appearance(?:-[2-9]\d*|-1\d+)?\.css$/.test(name);
function sheetName(manifest){
 if(manifest.appearance)return manifest.appearance.file;
 const names=new Set(manifest.files.map(file=>file.name.toLowerCase()));let name='website-appearance.css';
 for(let n=2;names.has(name);n++)name='website-appearance-'+n+'.css';return name;
}
function link(html,page,name,add){
 const nodes=[...descendants(parse(html,{sourceCodeLocationInfo:true}))],href=path.posix.relative(path.posix.dirname(page),name);
 const links=nodes.filter(n=>n.tagName==='link'&&attr(n,marker)===name);
 for(const node of links)if(attr(node,'rel')!=='stylesheet'||attr(node,'href')!==href||node.attrs.length!==3||!node.sourceCodeLocation)throw new AppError('CONFLICT');
 const head=nodes.find(n=>n.tagName==='head'),headLocation=head?.sourceCodeLocation;
 if(add&&links.length===1&&links[0].parentNode===head){
  const following=head.childNodes.slice(head.childNodes.indexOf(links[0])+1);
  if(!following.some(n=>n.tagName==='style'||n.tagName==='link'&&attr(n,'rel')?.toLowerCase().split(/\s+/).includes('stylesheet')))return html;
 }
 const changes=links.map(node=>({start:node.sourceCodeLocation.startOffset,end:node.sourceCodeLocation.endOffset,text:''}));
 if(add){
  const at=headLocation?.endTag?.startOffset??nodes.find(n=>n.tagName==='body')?.sourceCodeLocation?.startOffset??nodes.find(n=>n.tagName==='html')?.sourceCodeLocation?.startTag?.endOffset??nodes.find(n=>n.nodeName==='#documentType')?.sourceCodeLocation?.endOffset??0;
  changes.push({start:at,end:at,text:'<link rel="stylesheet" href="'+href+'" '+marker+'="'+name+'">'});
 }
 for(const change of changes.sort((a,b)=>b.start-a.start))html=html.slice(0,change.start)+change.text+html.slice(change.end);
 return html;
}
export function validateSavedAppearance(manifest){
 const a=manifest.appearance;if(a!==undefined&&(!a||!safeSheet(a.file)||!validAppearance(a.values)||!Object.keys(a.values).length))throw new AppError('FORMAT');
 if(a&&!manifest.files.some(f=>f.name===a.file&&f.appearanceSheet&&!f.draft))throw new AppError('FORMAT');
}
export async function syncSavedAppearance(store,manifest,signal){
 const appearance=manifest.appearance,prior=manifest.files.find(f=>f.appearanceSheet);
 if(!appearance&&!prior)return manifest;
 const name=appearance?.file??prior.name;if(!safeSheet(name)||appearance&&!validAppearance(appearance.values))throw new AppError('FORMAT');
 const files=[];
 for(const file of manifest.files){
  signal?.throwIfAborted();
  if(file.name===name){if(!file.appearanceSheet)throw new AppError('CONFLICT');continue;}
  if(!file.name.endsWith('.html')||appearance&&file.appearanceLink===name&&file.appearanceSeal===file.sha256){files.push(file);continue;}
  const before=await store.readText(file,{signal}),html=link(before,file.name,name,Boolean(appearance));
  const next=html===before?{...file}:{...file,...await store.siteFile(manifest.id,file.name,html,{draft:file.draft,signal})};
  if(appearance){next.appearanceLink=name;next.appearanceSeal=next.sha256;}else{delete next.appearanceLink;delete next.appearanceSeal;}
  files.push(next);
 }
 if(appearance){
  const css=appearanceCSS(appearance.values),hash=digest(css);
  files.push(prior?.sha256===hash?prior:{...await store.siteFile(manifest.id,name,css,{signal}),appearanceSheet:true});
 }
 return {...manifest,files};
}
export function savedAppearance(store,id,{expectedRevision,path='index.html',values,signal},write=false){
 if(typeof expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(expectedRevision)||write&&values!==null&&!validAppearance(values))throw new AppError('INVALID');
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision);
  if(!manifest.pages.some(p=>p.path===path))throw new AppError('NOT_FOUND');
  if(!write)return {values:manifest.appearance?.values??{},revision:manifest.revision};
  const next={...manifest};delete next.appearance;
  if(values&&Object.keys(values).length){
   const sorted={};for(const key of [...Object.keys(appearanceColors),'reading','heading'])if(Object.hasOwn(values,key))sorted[key]=values[key].toLowerCase();
   next.appearance={file:sheetName(manifest),values:sorted};
  }
  if(JSON.stringify(next.appearance)===JSON.stringify(manifest.appearance))return store.present(manifest,path,{signal});
  return store.present(await store.commit(next,{signal}),path,{signal});
 },{write,signal});
}
