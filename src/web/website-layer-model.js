import {websiteVisualSections} from './website-files-visual.js';

const protectedContent='[data-observanda-source],[data-observanda-link],[data-observanda-part],[data-website-instance],[data-observanda-editor],[data-image-gallery],[data-website-recording],[data-website-feed]';
export const managedWebsiteContent=protectedContent+',[data-website-menu],[data-website-source-gallery]';
const fixed='header,footer,nav,[hidden],main,'+protectedContent;
const flow='body,main,article,section,aside,div,li,dd,blockquote,figure,details,td,th';
const leafText='h1,h2,h3,h4,h5,h6,p,figcaption,summary,dt,dd';
const listItem=/^(LI|DT|DD)$/;

export function websiteLayerAt(doc,path){
 if(typeof path!=='string'||!/^\d+(?:\/\d+)*$/.test(path))return null;
 let node=doc.body;
 for(const index of path.split('/')){node=node.children[Number(index)];if(!node)return null;}
 return node;
}
export function layerPath(node){
 const path=[];
 while(node&&node!==node.ownerDocument.body){
  const parent=node.parentElement;
  if(!parent)return null;
  path.push(Array.prototype.indexOf.call(parent.children,node));node=parent;
 }
 return path.reverse().join('/');
}
function withinContent(node){
 if(!node||node.closest('header,footer,nav,[hidden],'+protectedContent))return false;
 const main=node.ownerDocument.querySelector('main:not([hidden])');
 return (main??node.ownerDocument.body).contains(node);
}
export function movableWebsiteLayer(node){
 return !!node&&withinContent(node)&&!node.matches('html,body,'+fixed+',summary,figcaption,td,th')&&!node.querySelector('header,footer,nav,'+protectedContent);
}
function accepts(parent,node){
 if(!withinContent(parent)||parent.closest('a,button,label,summary,p,h1,h2,h3,h4,h5,h6'))return false;
 if(parent.matches('ol,ul'))return node.matches('li');
 if(parent.matches('dl'))return node.matches('dt,dd');
 return !listItem.test(node.tagName)&&parent.matches(flow);
}

/** Returning an operation rather than moving during dragover keeps the saved tree intact. */
export function websiteLayerMove(node,target,placement){
 if(!movableWebsiteLayer(node)||!withinContent(target)||node===target||node.contains(target))return null;
 let parent,anchor;
 if(placement==='inside'){
  parent=target.querySelector(':scope > .container-content:only-child,:scope > .page-composition:only-child')??target;
  if(node.contains(parent))return null;
  anchor=parent.matches('figure')&&parent.lastElementChild?.matches('figcaption')?parent.lastElementChild:null;
 }else if(placement==='before'||placement==='after'){
  parent=target.parentElement;anchor=placement==='before'?target:target.nextSibling;
  if((placement==='before'&&target.matches('summary,figure > figcaption:first-child'))||
     (placement==='after'&&target.matches('figure > figcaption:last-child')))return null;
 }else return null;
 if(!accepts(parent,node)||node===anchor||(node.parentNode===parent&&node.nextSibling===anchor))return null;
 return ()=>{parent.insertBefore(node,anchor);return layerPath(node);};
}
export function foldLayerText(value){return String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();}
function label(node){
 const heading=node.matches(leafText)?node:node.querySelector(':scope > :is(h1,h2,h3,h4,h5,h6,summary,figcaption),:scope > .container-content > :is(h1,h2,h3,h4,h5,h6)');
 const attribute=node.getAttribute('aria-label')||node.getAttribute('alt')||node.id;
 if(!heading&&attribute)return attribute.slice(0,90);
 const walker=node.ownerDocument.createTreeWalker(heading??node,4);let value='';
 for(let i=0,text=walker.nextNode();i<12&&text;i++,text=walker.nextNode()){
  if(text.parentElement.closest('script,style,[hidden]'))continue;
  value+=text.data.slice(0,90-value.length);
  if(value.length>=90||(!heading&&value.trim()))break;
 }
 return value.trim()||attribute?.slice(0,90)||node.localName;
}
export function indexWebsiteLayers(doc){
 const rows=websiteVisualSections(doc,{includeContents:true}),byPath=new Map(),stack=[];
 for(const row of rows){
  stack.length=row.depth;row.parent=stack.at(-1)??null;row.branch=false;
  if(row.parent)row.parent.branch=true;
  row.label=label(row.node);row.search=foldLayerText(row.label+' '+row.node.localName+' '+row.node.id);
  byPath.set(row.path,row);stack.push(row);
 }
 return {rows,byPath};
}
