import {parseFragment} from 'parse5';
import {attr,descendants} from './website-migration-views.js';
import {AppError} from './errors.js';

// A retained edition and the permitted editor fragment can render the same
// identified figure differently. Resolve the SVG through its own download in
// the current source revision. Other figures and data downloads are distinct.
export function permittedFigureSVGs(fragment,assets){
 const allowed=new Set(assets.filter(asset=>asset.contentType==='image/svg+xml').map(asset=>asset.name));
 const result=new Map();
 for(const section of descendants(parseFragment(fragment))){
  const match=/^figure:([a-f0-9-]{36})$/.exec(attr(section,'data-observanda-part')??'');
  if(!match)continue;
  const links=[];
  for(const node of descendants(section)){
   const href=attr(node,'href');
   if(node.tagName!=='a'||attr(node,'download')===undefined||!allowed.has(href)||!/^assets\/[a-f0-9]{64}\.svg$/.test(href))continue;
   let parent=node.parentNode;
   while(parent!==section&&parent&&attr(parent,'data-observanda-part')===undefined)parent=parent.parentNode;
   if(parent===section)links.push(href);
  }
  // Duplicate figure identities or multiple eligible downloads are ambiguous.
  result.set(match[1],!result.has(match[1])&&links.length===1?links[0]:null);
 }
 return result;
}

export async function currentFigureSVGs(store,owner,{signal}){
 return store.scope(async()=>{
  const source=await store.source(owner.id);
  if(!source?.visible||source.target!=='website'||source.revision!==owner.revision)throw new AppError('CONFLICT');
  return permittedFigureSVGs(await store.readText(source.html,{signal}),source.assets);
 },{signal});
}
