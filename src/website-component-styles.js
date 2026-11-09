import path from 'node:path';
import {parse,parseFragment,serialize} from 'parse5';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {designStyleCopies} from './website-design-styles.js';
import {attr,descendants} from './website-migration-views.js';
import {websiteCSSByteLimit} from './web/website-css-urls.js';

export const componentPaint='data-website-component-style';
const linkMarker='data-website-component-sheet';
const sheetName=hash=>'component-style-'+hash+'.css';
const validHash=hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash);
const invalid=()=>{throw new AppError('INVALID');};
const styleIds=new WeakMap();
export function componentStyleId(main){
 if(!main.css)return null;
 if(!styleIds.has(main))styleIds.set(main,digest(main.css));return styleIds.get(main);
}
export function componentCSS(css,html,ranges){
 if(typeof css!=='string'||Buffer.byteLength(css)>websiteCSSByteLimit)invalid();
 if(!css)return '';
 const classes=new Set();
 for(const n of descendants(parseFragment(html)))for(const name of (attr(n,'class')??'').split(/\s+/))if(name)classes.add(name);
 const valid=designStyleCopies(css,ranges).admittedRules(classes);
 if(!valid)invalid();return valid.join('');
}
function scopedCSS(css,hash){
 // Each immutable revision also styles detached copies remaining on the
 // same page after a linked main changes. :where adds zero specificity.
 const owner='['+componentPaint+'="'+hash+'"]',scope=':where('+owner+','+owner+' *)';
 return css.replace(/(^|\n)((?:\/\* [a-z\d-]+ \*\/(?:@media [^{}\n]+ \{)?)?)(\.ow-(?:visual|layout)-[a-f0-9-]{36}(?:\.ow-layout-[a-f0-9-]{36})?) (?=\{)/g,'$1$2$3'+scope+' ');
}
function pageLinks(html,page){
 const document=parse(html,{sourceCodeLocationInfo:true}),ids=new Set(),links=[];let head;
 for(const node of descendants(document)){
  if(node.tagName==='head')head=node;
  const id=attr(node,componentPaint);if(id!==undefined){if(!validHash(id))invalid();ids.add(id);}
  if(node.tagName==='link'&&attr(node,linkMarker)!==undefined)links.push(node);
 }
 const used=[...ids].sort(),url=id=>path.posix.relative(path.posix.dirname(page),sheetName(id));
 if(used.length===links.length&&used.every((id,i)=>links[i].parentNode===head&&attr(links[i],linkMarker)===id&&attr(links[i],'href')===url(id)&&attr(links[i],'rel')==='stylesheet'))return {html,used};
 if(!head?.sourceCodeLocation?.endTag)return pageLinks(serialize(document),page);
 const changes=links.map(n=>({from:n.sourceCodeLocation.startOffset,to:n.sourceCodeLocation.endOffset,value:''}));
 if(used.length){
  const at=head.sourceCodeLocation.endTag.startOffset;changes.push({from:at,to:at,value:used.map(id=>'<link rel="stylesheet" href="'+url(id)+'" '+linkMarker+'="'+id+'">').join('')});
 }
 const parts=[];let at=0;
 for(const e of changes.sort((a,b)=>a.from-b.from)){parts.push(html.slice(at,e.from),e.value);at=e.to;}
 return {html:parts.join('')+html.slice(at),used};
}
export async function syncComponentStyles(store,manifest,signal){
 const definitions=new Map(),oldSheets=new Map(),files=[],used=new Map();
 for(const c of manifest.components??[])if(c.css){const hash=componentStyleId(c);definitions.set(hash,{css:c.css,private:!!c.draft&&(definitions.get(hash)?.private??true)});}
 if(!definitions.size&&!manifest.files.some(f=>f.componentSheet||f.hasComponentStyles))return manifest;
 for(const f of manifest.files)if(f.componentSheet)oldSheets.set(f.componentSheet,f);
 for(const f of manifest.files){
  signal?.throwIfAborted();
  if(f.componentSheet)continue;
  if(!f.name.endsWith('.html')||!f.hasComponentStyles&&!f.componentSeal){files.push(f);continue;}
  let next=f;
  if(f.componentSeal!==f.sha256){
   const html=await store.readText(f,{signal}),projection=pageLinks(html,f.name);
   next={...f,...(projection.html===html?{}:await store.siteFile(manifest.id,f.name,projection.html,{draft:f.draft,signal})),componentStyles:projection.used};
   next.componentSeal=next.sha256;
  }
  for(const hash of next.componentStyles??[]){
   const definition=definitions.get(hash),old=oldSheets.get(hash);
   if(!definition&&!old||!f.draft&&(!definition||definition.private)&&(!old||old.draft))invalid();
   used.set(hash,Boolean(used.get(hash))||!f.draft);
  }
  files.push(next);
 }
 const names=new Set(files.map(f=>f.name));
 for(const [hash,isPublic] of used){
  const old=oldSheets.get(hash),draft=!isPublic,name=sheetName(hash);
  if(names.has(name)||old&&old.name!==name)throw new AppError('CONFLICT');
  if(old&&!!old.draft===draft){files.push(old);continue;}
  const definition=definitions.get(hash),css=definition?scopedCSS(definition.css,hash):await store.readText(old,{signal});
  files.push({...await store.siteFile(manifest.id,name,css,{draft,signal}),componentSheet:hash});
 }
 return {...manifest,files};
}
