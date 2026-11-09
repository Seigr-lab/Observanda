import {websiteHTML} from './website-html-document.js';
import {checkAuthoredPage} from './website-author-checks.js';
import {fragmentIssue,pageAnchors} from './website-reference-targets.js';
import {websiteVisualSections} from './website-files-visual.js';
import {savedFileReference} from './website-files-navigation.js';
import {decodedWebsiteCSS,websiteCSSURLs} from './website-css-urls.js';
import {layerPath,managedWebsiteContent} from './website-layer-model.js';

// Never keep document trees after checking them. A bounded summary cache
// lets neighboring pages resolve each other's fragments without repeat reads.
const cacheBudget=2*1024*1024;
export function websiteReviewModel({catalogue,directory,read,signal,draftNames}){
 const files=new Set(catalogue.files),pages=new Map(catalogue.pages.map(p=>[p.path,p]));
 const subjects=catalogue.files.filter(path=>/\.(html|css)$/i.test(path));
 const cache=new Map();let reserved=0;
 async function summary(path){
  signal.throwIfAborted();
  const previous=cache.get(path);
  if(previous){cache.delete(path);cache.set(path,previous);return previous;}
  const html=await read(path,signal);signal.throwIfAborted();
  const value={issues:[],links:[],anchors:new Map(),cost:0};
  if(/\.css$/i.test(path)){
   for(const raw of websiteCSSURLs(decodedWebsiteCSS(html))){
    if(raw.startsWith('#'))continue;
    const file=savedFileReference(raw,new URL(path,directory),directory);
    if(!file||!files.has(file.path))value.issues.push({key:'missingFile',detail:raw.slice(0,200)});
   }
  }else{
   const doc=websiteHTML(html);value.anchors=pageAnchors(doc,{describe:true});
   let layers;
   function location(node){
    const feed=node.closest('[data-website-feed]');
    if(feed)return {feedId:feed.dataset.websiteFeed};
    if(!layers)layers=new Map(websiteVisualSections(doc,{includeContents:true}).map(row=>[row.node,row.path]));
    const target=!node.closest(managedWebsiteContent)&&doc.body.contains(node)?{elementPath:layerPath(node)}:{};
    for(let parent=node;parent;parent=parent.parentElement)if(layers.has(parent))return {...target,blockPath:layers.get(parent)};
    return target;
   }
   const issues=checkAuthoredPage(doc,path,directory,catalogue.pages,{files,pageNames:pages,draftNames,anchors:value.anchors,crossLink:({node,...link})=>value.links.push({...link,...location(node)})});
   for(const {key,node,detail} of issues)value.issues.push({key,detail,...location(node),...(['brokenLink','ambiguousLink','draftLink'].includes(key)?{href:node.getAttribute('href')}:{})});
  }
  value.cost=html.length*2+(value.anchors.size+value.issues.length+value.links.length)*160+256;
  if(value.cost<=cacheBudget){
   while(cache.size&&reserved+value.cost>cacheBudget){const oldest=cache.keys().next().value;reserved-=cache.get(oldest).cost;cache.delete(oldest);}
   cache.set(path,value);reserved+=value.cost;
  }
  return value;
 }
 async function findings(path,offset=0,limit=0){
  const result={total:0,items:[]};
  const add=issue=>{if(result.total++>=offset&&result.items.length<limit)result.items.push(issue);};
  const info=await summary(path);
  for(const issue of info.issues)add(issue);
  const targets=new Map();
  for(const link of info.links){
   if(!targets.has(link.path))targets.set(link.path,[]);
   targets.get(link.path).push(link);
  }
  for(const [target,links] of targets){
   const {anchors}=await summary(target);
   for(const {id,href,blockPath,feedId,elementPath} of links){
    const key=fragmentIssue(anchors,id);
    if(key)add({key,detail:href.slice(0,200),href,blockPath,feedId,elementPath});
   }
  }
  return result;
 }
 async function linkExists(raw,path){
  const url=new URL(raw,new URL(path,directory));
  if(url.origin!==directory.origin)return true;
  const ref=savedFileReference(raw,new URL(path,directory),directory);
  if(!ref||!files.has(ref.path))return false;
  if(!ref.hash||!pages.has(ref.path))return true;
  let id;try{id=decodeURIComponent(ref.hash.slice(1));}catch{return false;}
  return !fragmentIssue((await summary(ref.path)).anchors,id);
 }
 async function targets(path){
  if(!pages.has(path))return [];
  const {anchors}=await summary(path),result=[];
  for(const [id,description] of anchors)if(description&&typeof description==='object')result.push({id,...description});
  return result;
 }
 return {subjects,pages,findings,linkExists,targets};
}
