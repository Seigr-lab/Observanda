import {parse} from 'parse5';
import {AppError} from './errors.js';
import {websiteHTMLByteLimit} from './website-file-policy.js';

const managed=new Set(['data-observanda-source','data-observanda-link','data-website-feed','data-website-instance','data-website-source-gallery','data-website-menu']);

// Use parsed element-child indices, including implied table elements, exactly
// as the editable canvas does. Only the requested location leaves the service.
export function websiteSourceLocation(html,query){
 if(typeof html!=='string'||Buffer.byteLength(html)>websiteHTMLByteLimit)throw new AppError('LIMIT');
 const path=query?.path,offset=query?.offset;
 if(path===undefined?!Number.isSafeInteger(offset)||offset<0||offset>html.length:
     typeof path!=='string'||!/^\d+(?:\/\d+)*$/.test(path)||path.length>8192||offset!==undefined)throw new AppError('INVALID');
 const tree=parse(html,{sourceCodeLocationInfo:true}),elements=node=>(node.childNodes??[]).filter(child=>child.tagName);
 const document=elements(tree).find(node=>node.tagName==='html'),body=document&&elements(document).find(node=>node.tagName==='body');if(!body)return null;
 let node=body,indices=[],protectedRegion=false,last=null;
 const remember=()=>{
  protectedRegion||=(node.attrs??[]).some(attr=>managed.has(attr.name));
  const loc=node.sourceCodeLocation;if(!loc||!indices.length)return;
  last={path:indices.join('/'),start:loc.startOffset,end:loc.endOffset,tagEnd:loc.startTag?.endOffset??loc.endOffset,protectedRegion};
 };
 if(path!==undefined){
  for(const s of path.split('/')){node=elements(node)[Number(s)];if(!node)return null;indices.push(Number(s));remember();}
  return last?.path===path?last:null;
 }
 // Implied elements can enclose authored markup while having no source span.
 // A foster-parented child can also fall outside the parent's text range.
 const pending=[{node:body,index:0,path:null,protectedRegion:false}];let best=null;
 while(pending.length){
  const row=pending.pop(),loc=row.node.sourceCodeLocation;
  const owned=row.protectedRegion||(row.node.attrs??[]).some(attr=>managed.has(attr.name));
  if(row.path&&loc&&loc.startOffset<=offset&&offset<loc.endOffset&&(!best||loc.endOffset-loc.startOffset<=best.end-best.start)){
   best={row,start:loc.startOffset,end:loc.endOffset,tagEnd:loc.startTag?.endOffset??loc.endOffset,protectedRegion:owned};
  }
  const children=elements(row.node);for(let i=children.length-1;i>=0;i--)pending.push({node:children[i],index:i,path:row,protectedRegion:owned});
 }
 if(!best)return null;
 const chain=[];for(let row=best.row;row.path;row=row.path)chain.push(row.index);
 return {path:chain.reverse().join('/'),start:best.start,end:best.end,tagEnd:best.tagEnd,protectedRegion:best.protectedRegion};
}
