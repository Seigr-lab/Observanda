import path from 'node:path';
import {parse,parseFragment,serialize} from 'parse5';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {attr,descendants} from './website-migration-views.js';
import {escapeWebsiteText as esc} from './website-file-html.js';
import {validateWebsiteHTML} from './website-file-policy.js';
import en from './web/locales/en/websiteFeeds.json' with {type:'json'};
import ca from './web/locales/ca/websiteFeeds.json' with {type:'json'};
import es from './web/locales/es/websiteFeeds.json' with {type:'json'};
import nb from './web/locales/nb/websiteFeeds.json' with {type:'json'};
import nn from './web/locales/nn/websiteFeeds.json' with {type:'json'};

const landmark=node=>['header','nav','footer','aside'].includes(node.tagName)||(attr(node,'class')??'').split(/\s+/).some(c=>['site-top','site-header','site-masthead','site-footer','skip'].includes(c));
const denied=node=>['template','script','noscript'].includes(node.tagName)||node.nodeName==='#comment'||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true');
function localURL(raw,from,to,ids){
 if(!raw||/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(raw))return raw;
 if(raw.startsWith('#')&&ids.has(raw.slice(1)))return raw;
 const split=raw.indexOf('#'),name=split===-1?raw:raw.slice(0,split),fragment=split===-1?'':raw.slice(split);
 const target=name?path.posix.normalize(path.posix.join(path.posix.dirname(from),name)):from;
 return path.posix.relative(path.posix.dirname(to),target)+fragment;
}
const cssURLs=(css,from,to,ids)=>css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(all,a,b,c)=>{
 const raw=(a??b??c).trim();if(raw.startsWith('#'))return all;
 return 'url('+JSON.stringify(localURL(raw,from,to,ids))+')';
});
export function continuationShell(hostHTML,feed,cssPath){
 const doc=parse(hostHTML),nodes=[...descendants(doc)],body=nodes.find(n=>n.tagName==='body'),head=nodes.find(n=>n.tagName==='head');
 const slot=nodes.find(n=>attr(n,'data-website-feed')===feed.id);if(!slot||!head||!body)throw new AppError('FORMAT');
 const ancestry=new Set();for(let node=slot;node;node=node.parentNode)ancestry.add(node);
 const token='<!--website-feed-content-'+feed.id+'-->',language=attr(nodes.find(n=>n.tagName==='html'),'lang')||'en';
 const messages=({en,ca,es,nb,nn})[language.toLowerCase().split('-')[0]]??en;
 const destination='feeds/'+feed.id+'/page.html',home=path.posix.relative(path.posix.dirname(destination),feed.path)+'#website-feed-'+feed.id;
 function prune(node,inLandmark=false,inMain=false){
  if(node===slot)return {nodeName:'#comment',data:'website-feed-content-'+feed.id,parentNode:node.parentNode};
  if(denied(node)||attr(node,'data-website-feed')!==undefined)return null;
  const owned=node.attrs?.some(a=>a.name.startsWith('data-observanda-'));
  if(owned&&(node.tagName!=='a'||!attr(node,'href')||attr(node,'data-observanda-link-blocked')!==undefined))return null;
  if(owned)node.attrs=node.attrs.filter(a=>!a.name.startsWith('data-observanda-'));
  const keep=inLandmark||landmark(node);
  if(inMain&&!keep&&!ancestry.has(node))return null;
  if(!node.tagName)return keep&&node.nodeName==='#text'?node:null;
  node.childNodes=(node.childNodes??[]).map(child=>prune(child,keep,inMain||node.tagName==='main')).filter(Boolean);
  return keep||ancestry.has(node)||node.childNodes.length?node:null;
 }
 prune(body);
 head.childNodes=head.childNodes.filter(n=>!denied(n)&&!n.attrs?.some(a=>a.name.startsWith('data-observanda-'))&&
  (n.tagName==='style'||n.tagName==='link'&&['stylesheet','icon'].includes(attr(n,'rel'))&&!/(?:^|\/)source-[a-f0-9]{64}\.css$/.test(attr(n,'href')??'')||
   n.tagName==='meta'&&(attr(n,'charset')||['viewport','theme-color'].includes(attr(n,'name'))||attr(n,'http-equiv')==='Content-Security-Policy')));
 const title=parseFragment('<title>'+esc(feed.heading)+'</title>').childNodes[0];head.childNodes.push(title);
 const siteStyle=path.posix.relative(path.posix.dirname(feed.path),cssPath);
 if(!head.childNodes.some(n=>n.tagName==='link'&&attr(n,'rel')==='stylesheet'&&attr(n,'href')===siteStyle))head.childNodes.push(parseFragment('<link rel="stylesheet" href="'+esc(siteStyle)+'">').childNodes[0]);
 const ids=new Set([...descendants(doc)].flatMap(n=>attr(n,'id')?[attr(n,'id')]:[]));
 for(const node of descendants(doc))for(const a of node.attrs??[]){
  if(['href','src','poster','background'].includes(a.name))a.value=localURL(a.value,feed.path,destination,ids);
  if(a.name==='aria-current'&&a.value==='page')a.value='location';
  if(a.name==='style')a.value=cssURLs(a.value,feed.path,destination,ids);
 }
 for(const node of descendants(head))if(node.tagName==='style')for(const child of node.childNodes)if(child.nodeName==='#text')child.value=cssURLs(child.value,feed.path,destination,ids);
 const output=serialize(doc),at=output.indexOf(token);
 if(at<0||at!==output.lastIndexOf(token))throw new AppError('FORMAT');
 const back='<p class="website-feed-return"><a rel="up" href="'+esc(home)+'">'+esc(messages.return)+'</a></p>';
 const prefix=output.slice(0,at)+back,suffix=output.slice(at+token.length);
 return {stamp:createHash('sha256').update(prefix+'\0'+suffix).digest('hex'),render:markup=>prefix+markup+suffix};
}
export async function syncFeedShells(store,manifest,signal){
 if(!manifest.feeds?.some(feed=>feed.groups.length>1))return manifest;
 const files=new Map(manifest.files.map(f=>[f.name,f])),hosts=new Map(),feeds=[];
 for(const feed of manifest.feeds){
  const host=files.get(feed.path);if(feed.groups.length<2||host.sha256===feed.shellHost){feeds.push(feed);continue;}
  if(!hosts.has(feed.path))hosts.set(feed.path,await store.readText(host,{signal}));
  const shell=continuationShell(hosts.get(feed.path),feed,host.draft?'draft-styles.css':manifest.cssPath);
  for(const g of feed.groups.slice(1)){
   const name='feeds/'+feed.id+'/'+g.key+'.html',file=files.get(name);if(!file||file.feedPage!==feed.id)throw new AppError('FORMAT');
   if(file.feedShell===shell.stamp)continue;
   const html=await store.readText(file,{signal}),node=[...descendants(parse(html,{sourceCodeLocationInfo:true}))].find(n=>attr(n,'data-website-feed')===feed.id),loc=node?.sourceCodeLocation;
   if(!loc?.endTag)throw new AppError('FORMAT');
   const output=shell.render(html.slice(loc.startOffset,loc.endOffset));validateWebsiteHTML(output,{file:name});
   files.set(name,{...await store.siteFile(manifest.id,name,output,{draft:host.draft,signal}),feedPage:feed.id,feedShell:shell.stamp});
  }
  feeds.push({...feed,shellHost:host.sha256});
 }
 return {...manifest,feeds,files:[...files.values()]};
}
