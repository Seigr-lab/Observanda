// Capture a logical control before replacing its DOM. Retain identity rather
// than relying on a detached element after a save or background refresh.
const attributes=['data-action','data-value-field','data-section','data-id','data-command','data-tag-input','name','href','aria-label'];
export function captureFocus(element=document.activeElement){
 if(!element||element===document.body)return null;
 const selector=element.id?'#'+CSS.escape(element.id):element.tagName.toLowerCase()+attributes.filter(name=>element.hasAttribute(name)).map(name=>'['+name+'="'+CSS.escape(element.getAttribute(name))+'"]').join('');
 const area=element.closest('[data-record-edit-area]')?.dataset.recordEditArea;
 return {element,selector,index:[...document.querySelectorAll(selector)].indexOf(element),area,route:location.hash,selection:typeof element.selectionStart==='number'?[element.selectionStart,element.selectionEnd]:null};
}
export function focusElement(element,{scroll=false}={}){
 if(!element||element.closest('[inert]'))return false;
 for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
 if(!element.checkVisibility()||element.disabled)return false;
 if(!element.matches('a[href],button,input,select,textarea,[tabindex]'))element.tabIndex=-1;
 element.focus({preventScroll:!scroll});return document.activeElement===element;
}
export function focusMain(){return focusElement(document.querySelector('#main h1')??document.querySelector('#main'),{scroll:true});}
export function restoreFocus(saved,{fallback=true,force=false}={}){
 if(!saved||saved.route!==location.hash||document.querySelector('dialog[open]'))return false;
 const active=document.activeElement;
 if(!force&&active&&active!==document.body&&active.id!=='main'&&active!==saved.element&&active.isConnected)return false;
 const target=saved.element.isConnected?saved.element:document.querySelectorAll(saved.selector)[Math.max(saved.index,0)];
 if(focusElement(target)){if(saved.selection&&typeof target.setSelectionRange==='function')try{target.setSelectionRange(...saved.selection);}catch{}return true;}
 return fallback&&(focusElement(saved.area?document.querySelector('[data-record-edit-area="'+CSS.escape(saved.area)+'"]'):null)||focusMain());
}
let pending=null;
export function requestFocusRestore(saved){pending=saved;restorePendingFocus(true);}
export function restorePendingFocus(force=false){
 if(!pending)return;
 if(pending.route!==location.hash){pending=null;return;}
 if(restoreFocus(pending,{fallback:false,force}))pending=null;
}
// A new user interaction supersedes a return target waiting for a read.
if(typeof document!=='undefined')for(const name of ['pointerdown','keydown'])document.addEventListener(name,()=>{pending=null;},true);
