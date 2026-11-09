const byWindow=new WeakMap();
const inheriting=new Set(['font-family','font-size','font-weight','line-height','letter-spacing','text-align','color']);
function markerFor(window,key){
 let registered=byWindow.get(window);
 if(!registered){registered=new Map();byWindow.set(window,registered);}
 if(!registered.has(key)){
  const name='--ow-inspect-'+crypto.randomUUID();
  window.CSS.registerProperty({name,syntax:'*',inherits:inheriting.has(key),initialValue:'default'});
  registered.set(key,name);
 }
 return registered.get(key);
}
function sourceName(element,owner,selector,token){
 if(token){
  let scope=/\[data-website-(site|folder|page)-styles/.exec(selector)?.[1]??'element';
  if(scope==='element'){
   const textRun=owner?.localName==='span'&&owner.attributes.length===1&&owner.firstChild?.nodeType===3&&owner.childNodes.length===1;
   scope=textRun?'text':owner?.closest('[data-website-instance]')?'component':'element';
  }
  return {kind:'token',scope,token,selector};
 }
 if(element?.matches('link[data-website-theme-sheet],link[data-website-appearance]'))return {kind:'theme',selector};
 return {kind:/\.ow-visual-[a-f\d-]{36}/i.test(selector)?'inline':'rule',selector};
}

// Let the browser resolve selector specificity, !important, cascade layers,
// conditions and inheritance. Each candidate receives a temporary declaration
// alongside the real one. Reads and restoration are synchronous.
export function inspectWebsiteStyle(element,key){
 if(!element?.isConnected)return null;
 const document=element.ownerDocument,window=document.defaultView,computed=window.getComputedStyle(element),value=computed.getPropertyValue(key);
 const marker=markerFor(window,key),changes=[],inline=[],sources=new Map();
 function record(style,owner,rule){
  const declaration=style.getPropertyValue(key)||style.getPropertyValue('all');
  if(!declaration)return;
  const code='r'+sources.size;sources.set(code,{owner,rule});
  const replacement=['inherit','initial','unset','revert','revert-layer'].includes(declaration)?declaration:code;
  style.setProperty(marker,replacement,style.getPropertyPriority(key)||style.getPropertyPriority('all'));
  changes.push(style);
 }
 function rules(items,owner){
  for(const rule of items){
   if(rule.style&&rule.selectorText)record(rule.style,owner,rule);
   if(rule.cssRules)rules(rule.cssRules,owner);
  }
 }
 try{
  for(const sheet of document.styleSheets){
   const owner=sheet.ownerNode;
   if(sheet.disabled||owner?.hasAttribute('data-observanda-editor')&&owner.dataset.observandaEditor!=='css')continue;
   rules(sheet.cssRules,owner);
  }
  for(let at=element;at;at=at.parentElement){
   if(!at.style.getPropertyValue(key)&&!at.style.getPropertyValue('all'))continue;
   inline.push([at,at.getAttribute('style')]);record(at.style,at,null);
  }
  const winner=window.getComputedStyle(element).getPropertyValue(marker).trim();
  const matched=sources.get(winner);let source={kind:'default'};
  if(matched?.rule){
   const {owner,rule}=matched;let target;
   try{target=element.closest(rule.selectorText);}catch{/* Nested selectors are resolved by the browser's cascade. */}
   source=sourceName(owner,target,rule.selectorText,owner?.getAttribute('data-website-token-sheet'));
  }else if(matched){const at=matched.owner;source={kind:'inline',scope:at===element?'element':'ancestor',selector:at.localName};}
  return {value,...source};
 }finally{for(const style of changes)style.removeProperty(marker);for(const [node,text] of inline)node.setAttribute('style',text);}
}
