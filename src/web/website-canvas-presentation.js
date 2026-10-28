import {websiteRootStyle} from './website-root-style.js';
import {websiteTypography} from './website-typography.js';
import {mediaStyle} from './media-presentation.js';
const applied=new WeakMap();

export function updateCanvasPresentation(doc,book){
 const sheet=doc?.querySelector('link[href$="styles.css"]')?.sheet;if(!sheet)return;
 let cached=applied.get(doc);if(cached?.sheet!==sheet){cached={sheet,root:null,media:new WeakMap()};applied.set(doc,cached);}
 const replace=(selector,rule)=>{for(let i=sheet.cssRules.length-1;i>=0;i--)if(sheet.cssRules[i].selectorText===selector)sheet.deleteRule(i);sheet.insertRule(rule,sheet.cssRules.length);};
 const root=websiteRootStyle({...book.appearance,...book.website.palette,...websiteTypography(book)},book.website.design);
 if(root!==cached.root){replace(':root',root);cached.root=root;}
 for(const figure of doc.querySelectorAll('[data-media-scope][data-media-id]')){
  const {mediaScope:scope,mediaId:id}=figure.dataset,display=mediaStyle(book.website,scope,id),selector=`[data-media-scope="${scope}"][data-media-id="${id}"]`;
  const key=JSON.stringify(display);if(cached.media.get(figure)===key)continue;cached.media.set(figure,key);
  replace(selector,selector+'{width:'+display.width+'%;margin-inline:auto}');
  const mediaSelector=selector+' img, '+selector+' video',ratio={square:'1',landscape:'4/3',portrait:'3/4',wide:'16/9'}[display.ratio]??'auto';
  replace(mediaSelector,mediaSelector+'{aspect-ratio:'+ratio+';object-fit:'+display.fit+(ratio==='auto'?'':';width:100%')+'}');
  if(display.alt!==undefined)figure.querySelector('img')?.setAttribute('alt',display.alt||display.caption||'');
  if(display.caption!==undefined&&!scope.startsWith('cover:')){let caption=figure.querySelector(':scope>figcaption');if(!display.caption)caption?.remove();else{if(!caption){caption=doc.createElement('figcaption');figure.append(caption);}caption.textContent=display.caption;}}
 }
}
