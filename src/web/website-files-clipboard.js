import {websiteLink} from './website-links.js';

const semantic=new Set(['strong','em','u','s','sub','sup','mark','code','cite','small']);
const flow=new Set(['p','div','br','ol','ul','li','blockquote','pre','h1','h2','h3','h4','h5','h6']);
const aliases={b:'strong',i:'em',strike:'s',del:'s'};
const privateOrComplex='[data-observanda-source],[data-observanda-part],[data-observanda-link],[data-website-feed],[data-website-instance],[data-website-region],table,math,svg,img,audio,video';
const ignored='style,script,template,noscript,head,iframe,object,embed,form,input,button,[hidden],[aria-hidden="true"]';
const pasteBoundaries=new WeakMap();

// Parse into an inert template and reconstruct the allowed semantics. No
// pasted attributes, site identity, resource URLs or arbitrary CSS survive.
export function scientificClipboard(document,html){
 if(!html)return null;
 const from=html.indexOf('<!--StartFragment-->'),to=html.indexOf('<!--EndFragment-->');
 const source=document.createElement('template');source.innerHTML=from>=0&&to>from?html.slice(from+20,to):html;
 if(source.content.querySelector(privateOrComplex))return null;
 const output=document.createElement('template'),parents=new Map([[source.content,output.content]]);
 const walker=document.createTreeWalker(source.content,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
  acceptNode:node=>node.nodeType===1&&(node.namespaceURI!=='http://www.w3.org/1999/xhtml'||node.matches(ignored)||node.style?.display==='none'||node.style?.visibility==='hidden')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT
 });
 let formatted=false;
 for(let node=walker.nextNode();node;node=walker.nextNode()){
  let parent=parents.get(node.parentNode);
  if(node.nodeType===3){parent.append(document.createTextNode(node.data));continue;}
  const key=aliases[node.localName]??node.localName;
  if(flow.has(key)||semantic.has(key)){
   const value=document.createElement(key);parent.append(value);parent=value;formatted||=semantic.has(key);
  }else if(key==='a'){
   const link=websiteLink(node.getAttribute('href'));
   if(link?.external){
    const anchor=document.createElement('a');anchor.setAttribute('href',link.href);parent.append(anchor);parent=anchor;formatted=true;
   }
  }
  const styles=node.style,marks=[];
  if(styles.verticalAlign==='super')marks.push('sup');else if(styles.verticalAlign==='sub')marks.push('sub');
  if(styles.fontStyle==='italic'||styles.fontStyle==='oblique')marks.push('em');
  if(styles.fontWeight==='bold'||Number(styles.fontWeight)>=600)marks.push('strong');
  const decoration=styles.textDecorationLine||styles.textDecoration;
  if(decoration.includes('underline'))marks.push('u');if(decoration.includes('line-through'))marks.push('s');
  for(const mark of marks){if(mark===key)continue;const el=document.createElement(mark);parent.append(el);parent=el;formatted=true;}
  parents.set(node,parent);
 }
 return formatted?output:null;
}
export function insertClipboardMarkup(document,template,selection){
 // At an ordinary end-of-element caret Chromium adopts the preceding mark
 // on the next keystroke. A transient, empty noneditable boundary keeps
 // typed text outside the pasted exponent, link or emphasis.
 pasteBoundaries.get(document)?.();
 const range=selection.getRangeAt(0),selector='p,div,ol,ul,li,blockquote,pre,h1,h2,h3,h4,h5,h6';
 const blocks=!!template.content.querySelector(selector);let tail=template.content,caret=document.createElement('span');
 while(tail.lastChild?.nodeType===1&&tail.lastChild.matches(selector))tail=tail.lastChild;
 caret.contentEditable='false';caret.dataset.observandaEditor='paste-'+crypto.randomUUID();caret.setAttribute('aria-hidden','true');
 tail.append(caret);
 if(blocks){
  // Let the browser split paragraphs or lists at the actual insertion point.
  const id=caret.dataset.observandaEditor;document.execCommand('insertHTML',false,template.innerHTML);
  caret=document.querySelector('[data-observanda-editor="'+id+'"]');if(!caret)return;
 }else{range.deleteContents();range.insertNode(template.content);}
 range.setStartAfter(caret);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
 const controller=new document.defaultView.AbortController(),options={capture:true,signal:controller.signal};
 function clear(){controller.abort();caret.remove();pasteBoundaries.delete(document);}
 pasteBoundaries.set(document,clear);
 for(const event of ['input','focusout','pointerdown'])document.addEventListener(event,clear,options);
 document.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||['Backspace','Delete','Enter','Tab','Escape','Home','End','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))clear();
 },options);
}
