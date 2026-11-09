import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants} from './website-migration-views.js';
import {websiteLocalURL} from './website-file-policy.js';

export const sharedDraftStyle='draft-styles.css';
const owned=/^page-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.css$/;
export const pageStylesheet=(manifest,page)=>page?.stylePath??(page?.draft?sharedDraftStyle:manifest.cssPath);
export function newPageStylesheet(manifest){
 const names=new Set(manifest.files.map(file=>file.name.toLowerCase()));
 let name;
 do{name='page-'+randomUUID()+'.css';}while(names.has(name));
 return name;
}
export function validatePageStyles(pages,files){
 const named=new Set();
 for(const page of pages){
  if(page.stylePath===undefined)continue;
  const file=files.get(page.stylePath);
  if(!owned.test(page.stylePath)||named.has(page.stylePath)||!file||file.draft!==page.draft||file.sourceId||file.feedAsset)throw new AppError('FORMAT');
  named.add(page.stylePath);
 }
 for(const page of pages)if(page.canvasStyles!==undefined){
  const pin=page.canvasStyles;
  if(!pin||!/^[a-f0-9]{64}$/.test(pin.stamp)||!(pin.all===true&&pin.members===undefined||Array.isArray(pin.members)&&pin.members.length&&pin.members.every(name=>named.has(name)||files.get(name)?.tokenSheet===true||files.get(name)?.tokenFont===true)))throw new AppError('FORMAT');
 }
}
// Only change the selected document's main stylesheet link. Saved website
// bytes, including scripts, source markers and surrounding whitespace, survive.
export function addPageStyle(html,page,name){
 const href=path.posix.relative(path.posix.dirname(page),name);
 const head=[...descendants(parse(html,{sourceCodeLocationInfo:true}))].find(node=>node.tagName==='head');
 if(!head?.sourceCodeLocation?.endTag)throw new AppError('INVALID');
 if(head.childNodes.some(n=>n.tagName==='link'&&attr(n,'rel')==='stylesheet'&&attr(n,'href')===href))return html;
 const index=head.sourceCodeLocation.endTag.startOffset;
 return html.slice(0,index)+'<link rel="stylesheet" href="'+href+'">'+html.slice(index);
}
export function switchBaseStyle(html,page,from,to){
 const locations=[];
 for(const node of descendants(parse(html,{sourceCodeLocationInfo:true}))){
  if(node.tagName!=='link'||attr(node,'rel')!=='stylesheet'||websiteLocalURL(attr(node,'href'),page)!==from)continue;
  const loc=node.sourceCodeLocation?.attrs?.href;if(loc)locations.push(loc);
 }
 if(!locations.length)return html;
 const href='href="'+path.posix.relative(path.posix.dirname(page),to)+'"';
 for(const loc of locations.reverse())html=html.slice(0,loc.startOffset)+href+html.slice(loc.endOffset);
 return html;
}
