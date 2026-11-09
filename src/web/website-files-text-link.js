import {websiteReferencePath} from './website-local-fragment.js';

const textBlock='p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,caption,td,th,summary,pre,dt,dd';
const element=node=>node?.nodeType===1?node:node?.parentElement;
const inline='em,strong,i,b,u,s,del,mark,small,code,sub,sup,span';

function includeCompleteMarks(range){
 const movable=node=>node.nodeType===3||node.matches(inline)&&!node.matches('[id],[data-observanda-part],[data-observanda-source],[contenteditable]');
 while(range.startOffset===0&&movable(range.startContainer))range.setStartBefore(range.startContainer);
 while(movable(range.endContainer)){
  const node=range.endContainer;if(range.endOffset!==(node.nodeType===3?node.length:node.childNodes.length))break;
  range.setEndAfter(node);
 }
}

export function validWebsiteLink(value,base){
 if(!value||/[\\\s\u0000-\u001f]/.test(value))return false;
 let url;try{url=new URL(value,base);}catch{return false;}
 if(/^[a-z][a-z\d+.-]*:/i.test(value)){
  return url.protocol==='mailto:'||['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/^(?:localhost|127\.|\[::1\])/.test(url.hostname)&&!/^\/api(?:\/|$)/i.test(url.pathname);
 }
 const path=websiteReferencePath(value);if(path===null)return false;
 if(!path)return true;
 const root=new URL('./',base),revision=root.pathname.match(/^.*\/preview\/[^/]+\/[a-f0-9]{64}\//);
 return url.origin===root.origin&&url.pathname.startsWith(revision?.[0]??root.pathname);
}

// Hold the actual editable range while its window gives focus to the dialog.
// A link update changes only href; removing it preserves its inline children.
export function websiteTextLinks({document,tools,t,listen,safeRange,beforeChange,change}){
 const host=tools.ownerDocument;
 const make=(tag,text)=>{const node=host.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const button=(parent,label)=>{const node=make('button',t(label));node.type='button';parent.append(node);return node;};
 const edit=button(tools,'richLink'),remove=button(tools,'richUnlink');
 edit.setAttribute('aria-keyshortcuts','Control+K Meta+K');edit.setAttribute('aria-haspopup','dialog');
 let saved=null,textIntent=false;
 const dialog=make('dialog');dialog.className='website-author-dialog website-rich-link-dialog';dialog.setAttribute('aria-label',t('richLink'));
 const label=make('input'),address=make('input'),actions=make('div');actions.className='inline-actions';
 address.type='text';address.spellcheck=false;address.autocomplete='off';
 function field(key,control){const row=make('label',t(key));row.append(control);return row;}
 dialog.append(make('h2',t('richLink')),make('p',t('richLinkHelp')),field('richLinkFor',label),field('richLinkAddress',address),actions);
 const apply=button(actions,'richApplyLink'),cancel=button(actions,'cancel');
 // Keep the native dialog alongside its host; leaving this editor also
 // removes the dialog and prevents writes into an obsolete frame.
 tools.after(dialog);
 const anchor=range=>{const node=element(range?.startContainer)?.closest('a');return node?.contains(range.endContainer)?node:null;};
 function usable(range){
  if(!range||!document.body.contains(range.commonAncestorContainer)||!safeRange(range))return false;
  const first=element(range.startContainer),last=element(range.endContainer);
  const block=first.closest(textBlock)??first.closest('div,section,article,main,body');
  if(!block||!block.contains(last)||first.closest(textBlock)!==last.closest(textBlock))return false;
  if(range.collapsed&&range.startContainer.nodeType!==3&&!first.closest(textBlock))return false;
  const existing=anchor(range);
  if(existing)return !existing.matches('[data-observanda-link]');
  const root=element(range.commonAncestorContainer);
  if(first.closest('a')||last.closest('a'))return false;
  // Extracting part of an identified inline element would duplicate its ID.
  for(const node of root.querySelectorAll('a,[contenteditable="false"],[id]'))if(range.intersectsNode(node))return false;
  return true;
 }
 function sync(){const yes=usable(saved);edit.disabled=!yes;remove.disabled=!yes||!anchor(saved);}
 function capture(){
  if(dialog.open)return;
  const selection=document.getSelection();if(selection?.rangeCount)saved=selection.getRangeAt(0).cloneRange();
  sync();
 }
 function restore(){
  if(!usable(saved))return false;
  element(saved.startContainer).closest('[contenteditable="true"]')?.focus({preventScroll:true});
  const selection=document.getSelection();selection.removeAllRanges();selection.addRange(saved);return true;
 }
 function open(){
  if(!usable(saved)||!tools.isConnected)return false;
  const node=anchor(saved);label.value=node?.textContent??saved.toString();
  label.readOnly=Boolean(node||!saved.collapsed);address.value=node?.getAttribute('href')??'';
  address.setCustomValidity('');dialog.showModal();address.focus();address.select();return true;
 }
 function submit(){
  const href=address.value.trim();
  if(!validWebsiteLink(href,document.location.href)){address.setCustomValidity(t('badLink'));address.reportValidity();return;}
  if(!usable(saved)){dialog.close();return;}
  const range=saved.cloneRange(),node=anchor(range);dialog.close();saved=range;
  if(!restore())return;
  beforeChange();
  if(node)node.setAttribute('href',href);
  else{
   const a=document.createElement('a');a.setAttribute('href',href);
   if(range.collapsed)a.textContent=label.value.trim()||href;
   else{includeCompleteMarks(range);a.append(range.extractContents());}
   range.insertNode(a);range.selectNodeContents(a);
   const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
  }
  change();capture();
 }
 listen(edit,'click',open);
 listen(remove,'click',()=>{if(!restore())return;const node=anchor(saved);if(!node)return;beforeChange();node.replaceWith(...node.childNodes);change();capture();});
 listen(cancel,'click',()=>{dialog.close();restore();});listen(dialog,'cancel',event=>{event.preventDefault();dialog.close();restore();});
 listen(address,'input',()=>address.setCustomValidity(''));listen(apply,'click',submit);
 listen(dialog,'keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'&&!event.isComposing){event.preventDefault();submit();}});
 listen(document,'selectionchange',()=>{if(host.activeElement?.contentDocument===document)capture();});
 listen(document,'pointerdown',event=>{textIntent=Boolean(element(event.target)?.closest(textBlock));});
 listen(document,'beforeinput',()=>{textIntent=true;});
 for(const event of ['keyup','pointerup','focusout'])listen(document,event,capture);
 listen(document,'keydown',event=>{
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))textIntent=true;
  if(event.defaultPrevented||event.isComposing||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='k')return;
  capture();if((!saved?.collapsed||textIntent)&&open()){event.preventDefault();event.stopImmediatePropagation();}
 });
 sync();
}
