import {websiteVisualSections} from './website-files-visual.js';
import {protectedWebsiteContent as protectedContent,managedWebsiteContent} from './website-authored-nodes.js';
export {managedWebsiteContent};

const fixed='header,footer,nav,[hidden],main,'+protectedContent;
const flow='body,header,footer,main,article,section,aside,div,li,dd,blockquote,figure,details,td,th';
const indivisible='nav,'+managedWebsiteContent;
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
 return !!node&&withinContent(node)&&!node.closest(managedWebsiteContent)&&!node.matches('html,body,'+fixed+',summary,figcaption,td,th')&&!node.querySelector('header,footer,nav,'+managedWebsiteContent);
}
// Reordering preserves the whole subtree. Generated entries, component instances
// and navigation may travel intact, but their descendants belong to their owner.
export function reorderableWebsiteLayer(node){
 return !!node&&node.ownerDocument.body.contains(node)&&!node.closest('[hidden],.skip,[data-observanda-editor]')&&
  !node.matches('html,body,summary,figcaption,td,th,[data-observanda-part],[data-observanda-link]')&&!node.parentElement?.closest(indivisible);
}
function accepts(parent,node){
 if(!parent||parent.ownerDocument!==node.ownerDocument||!parent.ownerDocument.body.contains(parent)||parent.closest(indivisible+',a,button,label,summary,p,h1,h2,h3,h4,h5,h6,[hidden]'))return false;
 if(parent.matches('ol,ul'))return node.matches('li');
 if(parent.matches('dl'))return node.matches('dt,dd');
 if((node.matches('main')||node.querySelector('main'))&&parent.closest('main,article,aside,footer,header,nav'))return false;
 if((node.matches('header,footer')||node.querySelector('header,footer'))&&parent.closest('header,footer'))return false;
 return !listItem.test(node.tagName)&&parent.matches(flow);
}

/** Returning an operation rather than moving during dragover keeps the saved tree intact. */
export function websiteLayerMove(node,target,placement){
 if(!reorderableWebsiteLayer(node)||!target||node===target||node.contains(target)||target.closest('[hidden],.skip,[data-observanda-editor]'))return null;
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
 if(!accepts(parent,node)||node===anchor||node.parentNode===parent&&(
   placement==='before'&&node.nextElementSibling===target||placement==='after'&&node.previousElementSibling===target||placement==='inside'&&node.nextElementSibling===anchor))return null;
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
 const rows=websiteVisualSections(doc,{includeContents:true}),byPath=new Map(),byNode=new WeakMap(),stack=[];
 for(const row of rows){
  stack.length=row.depth;row.parent=stack.at(-1)??null;row.branch=false;
  if(row.parent)row.parent.branch=true;
  refreshLayerLabel(row);byPath.set(row.path,row);byNode.set(row.node,row);stack.push(row);
 }
 return {rows,byPath,byNode};
}
export function refreshLayerLabel(row){
 const next=label(row.node),search=foldLayerText(next+' '+row.node.localName+' '+row.node.id);
 if(row.label===next&&row.search===search)return false;
 row.label=next;row.search=search;return true;
}
